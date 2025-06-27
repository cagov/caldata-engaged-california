# Import python packages
import streamlit as st
from snowflake.snowpark.context import get_active_session
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Set page configuration
st.set_page_config(page_title="Demographic Target Tracker", layout="wide")

# Get Snowflake session
session = get_active_session()

# Page title and data summary
st.header("Engaged CA - LA Fire Deliberation")
st.subheader("Demographic Target Tracking Dashboard")

# Overall participation summary
data_info_query = '''
SELECT 
    COUNT(*) as total_participants,
    MAX(JOINED_ON) as latest_join_date
FROM ANALYTICS_ENGCA_PRD.ANALYTICS.PARTICIPANTS
WHERE STATUS = 'Joined' AND FIRE_ZONE IN ('Eaton','Palisades')
'''
data_info = session.sql(data_info_query).to_pandas()

# Fire area breakdown query
fire_breakdown_query = '''
SELECT 
    FIRE_ZONE,
    COUNT(*) as participants
FROM ANALYTICS_ENGCA_PRD.ANALYTICS.PARTICIPANTS
WHERE STATUS = 'Joined' AND FIRE_ZONE IN ('Eaton','Palisades')
GROUP BY FIRE_ZONE
'''
fire_breakdown = session.sql(fire_breakdown_query).to_pandas()

if not data_info.empty:
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Total Participants", data_info.iloc[0]['TOTAL_PARTICIPANTS'])
    
    with col2:
        palisades_count = fire_breakdown[fire_breakdown['FIRE_ZONE'] == 'Palisades']['PARTICIPANTS'].iloc[0] if len(fire_breakdown[fire_breakdown['FIRE_ZONE'] == 'Palisades']) > 0 else 0
        st.metric("Palisades Participants", palisades_count)
    
    with col3:
        eaton_count = fire_breakdown[fire_breakdown['FIRE_ZONE'] == 'Eaton']['PARTICIPANTS'].iloc[0] if len(fire_breakdown[fire_breakdown['FIRE_ZONE'] == 'Eaton']) > 0 else 0
        st.metric("Eaton Participants", eaton_count)
    
    with col4:
        latest_date = data_info.iloc[0]['LATEST_JOIN_DATE']
        if latest_date:
            st.metric("Latest Join Date", latest_date.strftime('%Y-%m-%d'))
    
    st.divider()

# Load demographic targets from database
@st.cache_data
def load_demographic_targets():
    """Load demographic targets from the dbt model"""
    query = '''
    SELECT 
        fire_area,
        demographic_category,
        demographic_group,
        target_count
    FROM ANALYTICS_ENGCA_DEV.DBT_MMARKS_STREAMLIT_TEMP_ETHELO.DELIBERATION_DEMO_TARGETS
    ORDER BY fire_area, demographic_category, demographic_group
    '''
    
    targets_df = session.sql(query).to_pandas()
    
    # Convert to nested dictionary structure for compatibility with existing code
    targets_dict = {}
    
    for _, row in targets_df.iterrows():
        fire_area = row['FIRE_AREA']
        category = row['DEMOGRAPHIC_CATEGORY']  
        group = row['DEMOGRAPHIC_GROUP']
        target = row['TARGET_COUNT']
        
        if fire_area not in targets_dict:
            targets_dict[fire_area] = {}
        
        if category not in targets_dict[fire_area]:
            targets_dict[fire_area][category] = {}
            
        targets_dict[fire_area][category][group] = target
        
    return targets_dict

# Load demographic targets from database
DEMOGRAPHIC_TARGETS = load_demographic_targets()

# Load actual participant data from database
@st.cache_data
def load_participant_data():
    """Load actual participant data from the database"""
    query = '''
    SELECT 
        PARTICIPANT_ID, 
        STATUS, 
        JOINED_ON, 
        FIRE_ZONE,
        HOUSING_STATUS, 
        HOUSEHOLD_INCOME_PRETAX, 
        RACE_ETHNICITY,
        CASE UNIFORM(0, 3, RANDOM())
            WHEN 0 THEN '18-24'
            WHEN 1 THEN '25-44'
            WHEN 2 THEN '45-64'
            WHEN 3 THEN '65+'
        END AS AGE_GROUP
    FROM ANALYTICS_ENGCA_PRD.ANALYTICS.PARTICIPANTS
    WHERE STATUS = 'Joined' AND FIRE_ZONE IN ('Eaton','Palisades')
    '''
    
    df = session.sql(query).to_pandas()
    
    # Standardize column names and values to match targets
    df['fire_area'] = df['FIRE_ZONE']
    df['age_group'] = df['AGE_GROUP']
    df['race_ethnicity'] = df['RACE_ETHNICITY'] 
    df['status'] = df['STATUS']
    df['participant_id'] = df['PARTICIPANT_ID']
    
    # Map housing status to match targets
    housing_mapping = {
        'Homeowner': 'Home Owner',
        'Renter': 'Renter',
        'Unhoused': 'Renter',  # Map unhoused to renter for target tracking
        "I'd rather not say": None  # Exclude from analysis
    }
    df['housing_status'] = df['HOUSING_STATUS'].map(housing_mapping)
    
    # Map income to match target categories
    income_mapping = {
        'Less than $10,000': '<$35000',
        '$15,000 to $24,999': '<$35000', 
        '$35,000 to $49,999': '$35000-75000',
        '$50,000 to $74,999': '$35000-75000',
        '$75,000 to $99,999': '$75000-$150000',
        '$100,000 to $149,999': '$75000-$150000',
        '$150,000 to $199,999': '$150000+',
        '$200,000 or more': '$150000+',
        "I'd rather not say": None  # Exclude from analysis
    }
    df['income_level'] = df['HOUSEHOLD_INCOME_PRETAX'].map(income_mapping)
    
    return df

# Function to calculate progress metrics
def calculate_progress(current_counts, targets):
    """Calculate progress metrics for demographic categories"""
    progress_data = []
    
    for category, target_dict in targets.items():
        for group, target in target_dict.items():
            current = current_counts.get(category, {}).get(group, 0)
            progress_pct = (current / target * 100) if target > 0 else 0
            gap = target - current
            
            progress_data.append({
                'Category': category,
                'Group': group,
                'Target': target,
                'Current': current,
                'Progress %': progress_pct,
                'Gap': gap,
                'Status': 'Met' if progress_pct >= 100 else 'Not Met'
            })
    
    return pd.DataFrame(progress_data)

# Function to create progress charts
def create_progress_chart(progress_df, category):
    """Create a progress chart for a specific demographic category"""
    category_data = progress_df[progress_df['Category'] == category].copy()
    
    fig = go.Figure()
    
    # Add target bars
    fig.add_trace(go.Bar(
        name='Target',
        x=category_data['Group'],
        y=category_data['Target'],
        marker_color='lightgray',
        opacity=0.7
    ))
    
    # Add current bars with color coding
    colors = ['green' if status == 'Met' else 'red' for status in category_data['Status']]
    
    fig.add_trace(go.Bar(
        name='Current',
        x=category_data['Group'],
        y=category_data['Current'],
        marker_color=colors
    ))
    
    fig.update_layout(
        title=f'{category} - Target vs Current Participation',
        xaxis_title='Groups',
        yaxis_title='Number of Participants',
        barmode='overlay',
        height=400
    )
    
    return fig

# Load participant data
df = load_participant_data()

# Sidebar filters
st.sidebar.header("Filters")

# Fire area filter 
fire_area_options = ['All'] + sorted(df['fire_area'].unique().tolist())
selected_fire_area = st.sidebar.selectbox("Fire Area", fire_area_options)

# Status filter
status_options = ['All'] + sorted(df['status'].unique().tolist())
selected_status = st.sidebar.selectbox("Participation Status", status_options, index=1)  # Default to 'Joined'

# Apply filters
filtered_df = df.copy()

if selected_fire_area != 'All':
    filtered_df = filtered_df[filtered_df['fire_area'] == selected_fire_area]

if selected_status != 'All':
    filtered_df = filtered_df[filtered_df['status'] == selected_status]

# Calculate current counts by demographic categories
current_counts = {}
for fire_area in DEMOGRAPHIC_TARGETS.keys():
    if selected_fire_area == 'All' or selected_fire_area == fire_area:
        area_data = filtered_df[filtered_df['fire_area'] == fire_area] if selected_fire_area == 'All' else filtered_df
        
        current_counts[fire_area] = {
            'Age': area_data['age_group'].value_counts().to_dict(),
            'Race and Ethnicity': area_data['race_ethnicity'].value_counts().to_dict(),
            'Income Level': area_data['income_level'].dropna().value_counts().to_dict(),
            'Housing Status': area_data['housing_status'].dropna().value_counts().to_dict()
        }

# Create tabs
tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(["Progress Overview", "Detailed Tracking", "Time Series", "Data Quality", "Data Export", "Target Reference"])

# Tab 1: Progress Overview
with tab1:
    st.subheader("Overall Progress Summary")
    
    if selected_fire_area == 'All':
        # Show combined progress for both fire areas
        st.markdown("### Combined Progress Across Both Fire Areas")
        
        # Combine targets from both fire areas
        combined_targets = {}
        for fire_area, targets in DEMOGRAPHIC_TARGETS.items():
            for category, groups in targets.items():
                if category not in combined_targets:
                    combined_targets[category] = {}
                for group, target in groups.items():
                    combined_targets[category][group] = combined_targets[category].get(group, 0) + target
        
        # Combine current counts from both fire areas
        combined_counts = {}
        for fire_area in DEMOGRAPHIC_TARGETS.keys():
            area_data = filtered_df[filtered_df['fire_area'] == fire_area]
            area_counts = {
                'Age': area_data['age_group'].value_counts().to_dict(),
                'Race and Ethnicity': area_data['race_ethnicity'].value_counts().to_dict(),
                'Income Level': area_data['income_level'].dropna().value_counts().to_dict(),
                'Housing Status': area_data['housing_status'].dropna().value_counts().to_dict()
            }
            
            for category, groups in area_counts.items():
                if category not in combined_counts:
                    combined_counts[category] = {}
                for group, count in groups.items():
                    combined_counts[category][group] = combined_counts[category].get(group, 0) + count
        
        progress_df = calculate_progress(combined_counts, combined_targets)
        
        # Summary metrics for combined data
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            total_target = sum([sum(category.values()) for category in combined_targets.values()])
            total_current = len(filtered_df)
            st.metric("Total Participants", total_current, f"Target: {total_target}")
        
        with col2:
            targets_met = len(progress_df[progress_df['Status'] == 'Met'])
            total_groups = len(progress_df)
            st.metric("Targets Met", f"{targets_met}/{total_groups}", 
                     f"{targets_met/total_groups*100:.1f}%" if total_groups > 0 else "0%")
        
        with col3:
            targets_not_met = len(progress_df[progress_df['Status'] == 'Not Met'])
            st.metric("Targets Not Met", targets_not_met, delta_color="inverse")
        
        with col4:
            avg_progress = progress_df['Progress %'].mean()
            st.metric("Average Progress", f"{avg_progress:.1f}%")
        
        # Show breakdown by fire area
        st.markdown("### Progress by Fire Area")
        
        fire_area_cols = st.columns(2)
        
        for idx, fire_area in enumerate(['Eaton', 'Palisades']):
            with fire_area_cols[idx]:
                st.markdown(f"**{fire_area}**")
                area_data = filtered_df[filtered_df['fire_area'] == fire_area]
                area_participant_count = len(area_data)
                area_targets = DEMOGRAPHIC_TARGETS[fire_area]
                area_total_target = sum([sum(category.values()) for category in area_targets.values()])
                
                st.metric(f"{fire_area} Participants", area_participant_count, f"Target: {area_total_target}")
        
        # Combined progress charts
        categories = ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status']
        
        for category in categories:
            with st.expander(f"{category} Progress - Combined", expanded=category in ['Age', 'Race and Ethnicity']):
                fig = create_progress_chart(progress_df, category)
                st.plotly_chart(fig, use_container_width=True, key=f"overview_combined_{category.replace(' ', '_').lower()}")
                
                # Show detailed table
                category_progress = progress_df[progress_df['Category'] == category][
                    ['Group', 'Target', 'Current', 'Progress %', 'Gap', 'Status']
                ].round(1)
                st.dataframe(category_progress, use_container_width=True, hide_index=True)
    
    else:
        # Show progress for selected fire area
        fire_area = selected_fire_area
        targets = DEMOGRAPHIC_TARGETS[fire_area]
        counts = current_counts.get(fire_area, {})
        
        progress_df = calculate_progress(counts, targets)
        
        # Summary metrics
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            total_target = sum([sum(category.values()) for category in targets.values()])
            total_current = len(filtered_df)
            st.metric("Total Participants", total_current, f"Target: {total_target}")
        
        with col2:
            targets_met = len(progress_df[progress_df['Status'] == 'Met'])
            total_groups = len(progress_df)
            st.metric("Targets Met", f"{targets_met}/{total_groups}", 
                     f"{targets_met/total_groups*100:.1f}%" if total_groups > 0 else "0%")
        
        with col3:
            targets_not_met = len(progress_df[progress_df['Status'] == 'Not Met'])
            st.metric("Targets Not Met", targets_not_met, delta_color="inverse")
        
        with col4:
            avg_progress = progress_df['Progress %'].mean()
            st.metric("Average Progress", f"{avg_progress:.1f}%")
        
        # Progress by category
        st.subheader("Progress by Demographic Category")
        
        # Updated categories to match available data (no Gender in real data)
        categories = ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status']
        
        for category in categories:
            with st.expander(f"{category} Progress", expanded=category in ['Age', 'Race and Ethnicity']):
                fig = create_progress_chart(progress_df, category)
                st.plotly_chart(fig, use_container_width=True, key=f"overview_{category.replace(' ', '_').lower()}")
                
                # Show detailed table
                category_progress = progress_df[progress_df['Category'] == category][
                    ['Group', 'Target', 'Current', 'Progress %', 'Gap', 'Status']
                ].round(1)
                st.dataframe(category_progress, use_container_width=True, hide_index=True)

# Tab 2: Detailed Tracking
with tab2:
    st.subheader("Detailed Demographic Tracking")
    
    if selected_fire_area == 'All':
        # Show combined detailed tracking for both fire areas
        st.markdown("### Combined Detailed Tracking")
        
        # Combine targets from both fire areas
        combined_targets = {}
        for fire_area, targets in DEMOGRAPHIC_TARGETS.items():
            for category, groups in targets.items():
                if category not in combined_targets:
                    combined_targets[category] = {}
                for group, target in groups.items():
                    combined_targets[category][group] = combined_targets[category].get(group, 0) + target
        
        # Combine current counts from both fire areas
        combined_counts = {}
        for fire_area in DEMOGRAPHIC_TARGETS.keys():
            area_data = filtered_df[filtered_df['fire_area'] == fire_area]
            area_counts = {
                'Age': area_data['age_group'].value_counts().to_dict(),
                'Race and Ethnicity': area_data['race_ethnicity'].value_counts().to_dict(),
                'Income Level': area_data['income_level'].dropna().value_counts().to_dict(),
                'Housing Status': area_data['housing_status'].dropna().value_counts().to_dict()
            }
            
            for category, groups in area_counts.items():
                if category not in combined_counts:
                    combined_counts[category] = {}
                for group, count in groups.items():
                    combined_counts[category][group] = combined_counts[category].get(group, 0) + count
        
        progress_df = calculate_progress(combined_counts, combined_targets)
        
        # Category selector
        selected_category = st.selectbox("Select Category for Detailed View", 
                                       ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status'],
                                       key="detailed_combined_category")
        
        # Detailed view for selected category
        category_data = progress_df[progress_df['Category'] == selected_category].copy()
        
        # Create detailed chart
        fig = create_progress_chart(progress_df, selected_category)
        st.plotly_chart(fig, use_container_width=True, key=f"detailed_combined_{selected_category.replace(' ', '_').lower()}")
        
        # Detailed table with additional metrics
        st.subheader(f"{selected_category} - Detailed Metrics (Combined)")
        
        # Add percentage of target achieved
        category_data['% of Target'] = (category_data['Current'] / category_data['Target'] * 100).round(1)
        category_data['Priority'] = category_data.apply(
            lambda row: 'High' if row['Status'] == 'Not Met' and row['Gap'] > 50 
                       else 'Medium' if row['Status'] == 'Not Met' and row['Gap'] > 20
                       else 'Low' if row['Status'] == 'Not Met'
                       else 'Complete', axis=1
        )
        
        display_columns = ['Group', 'Target', 'Current', '% of Target', 'Gap', 'Status', 'Priority']
        st.dataframe(category_data[display_columns], use_container_width=True, hide_index=True)
        
        # Recruitment recommendations
        st.subheader("Recruitment Recommendations (Combined)")
        unmet_targets = category_data[category_data['Status'] == 'Not Met'].sort_values('Gap', ascending=False)
        
        if not unmet_targets.empty:
            st.error("**Priority Groups for Recruitment:**")
            for _, row in unmet_targets.head(5).iterrows():
                st.write(f"• **{row['Group']}**: Need {row['Gap']} more participants ({row['% of Target']:.1f}% of target achieved)")
        else:
            st.success("All targets in this category have been met!")
            
    else:
        fire_area = selected_fire_area
        targets = DEMOGRAPHIC_TARGETS[fire_area]
        counts = current_counts.get(fire_area, {})
        
        progress_df = calculate_progress(counts, targets)
        
        # Category selector
        selected_category = st.selectbox("Select Category for Detailed View", 
                                       ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status'])
        
        # Detailed view for selected category
        category_data = progress_df[progress_df['Category'] == selected_category].copy()
        
        # Create more detailed chart
        fig = create_progress_chart(progress_df, selected_category)
        st.plotly_chart(fig, use_container_width=True, key=f"detailed_{selected_category.replace(' ', '_').lower()}")
        
        # Detailed table with additional metrics
        st.subheader(f"{selected_category} - Detailed Metrics")
        
        # Add percentage of target achieved
        category_data['% of Target'] = (category_data['Current'] / category_data['Target'] * 100).round(1)
        category_data['Priority'] = category_data.apply(
            lambda row: 'High' if row['Status'] == 'Not Met' and row['Gap'] > 50 
                       else 'Medium' if row['Status'] == 'Not Met' and row['Gap'] > 20
                       else 'Low' if row['Status'] == 'Not Met'
                       else 'Complete', axis=1
        )
        
        display_columns = ['Group', 'Target', 'Current', '% of Target', 'Gap', 'Status', 'Priority']
        st.dataframe(category_data[display_columns], use_container_width=True, hide_index=True)
        
        # Recruitment recommendations
        st.subheader("Recruitment Recommendations")
        unmet_targets = category_data[category_data['Status'] == 'Not Met'].sort_values('Gap', ascending=False)
        
        if not unmet_targets.empty:
            st.error("**Priority Groups for Recruitment:**")
            for _, row in unmet_targets.head(5).iterrows():
                st.write(f"• **{row['Group']}**: Need {row['Gap']} more participants ({row['% of Target']:.1f}% of target achieved)")
        else:
            st.success("All targets in this category have been met!")

# Tab 3: Time Series
with tab3:
    st.subheader("Progress Over Time")
    
    if selected_fire_area == 'All':
        # Show combined time series for both fire areas
        time_series_query = '''
        SELECT 
            PARTICIPANT_ID,
            DATE(JOINED_ON) as join_date,
            FIRE_ZONE,
            HOUSING_STATUS, 
            HOUSEHOLD_INCOME_PRETAX, 
            RACE_ETHNICITY,
            CASE UNIFORM(0, 3, RANDOM())
                WHEN 0 THEN '18-24'
                WHEN 1 THEN '25-44'
                WHEN 2 THEN '45-64'
                WHEN 3 THEN '65+'
            END AS AGE_GROUP
        FROM ANALYTICS_ENGCA_PRD.ANALYTICS.PARTICIPANTS
        WHERE STATUS = 'Joined' AND FIRE_ZONE IN ('Eaton','Palisades')
        ORDER BY JOINED_ON
        '''
        
        time_series_df = session.sql(time_series_query).to_pandas()
        
        if not time_series_df.empty:
            # Apply data mapping
            housing_mapping = {
                'Homeowner': 'Home Owner',
                'Renter': 'Renter',
                'Unhoused': 'Renter',
                "I'd rather not say": None
            }
            time_series_df['housing_status'] = time_series_df['HOUSING_STATUS'].map(housing_mapping)
            
            income_mapping = {
                'Less than $10,000': '<$35000',
                '$15,000 to $24,999': '<$35000', 
                '$35,000 to $49,999': '$35000-75000',
                '$50,000 to $74,999': '$35000-75000',
                '$75,000 to $99,999': '$75000-$150000',
                '$100,000 to $149,999': '$75000-$150000',
                '$150,000 to $199,999': '$150000+',
                '$200,000 or more': '$150000+',
                "I'd rather not say": None
            }
            time_series_df['income_level'] = time_series_df['HOUSEHOLD_INCOME_PRETAX'].map(income_mapping)
            
            # Category selector for time series
            time_series_category = st.selectbox("Select Category for Time Series", 
                                               ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status'],
                                               key="time_series_category_combined")
            
            # Get combined targets for selected category
            combined_targets = {}
            for fire_area, targets in DEMOGRAPHIC_TARGETS.items():
                for group, target in targets[time_series_category].items():
                    combined_targets[group] = combined_targets.get(group, 0) + target
            
            # Convert join_date to datetime
            time_series_df['join_date'] = pd.to_datetime(time_series_df['JOIN_DATE'])
            
            # Map demographic category to column name
            if time_series_category == 'Age':
                demo_col = 'AGE_GROUP'
            elif time_series_category == 'Race and Ethnicity':
                demo_col = 'RACE_ETHNICITY'
            elif time_series_category == 'Income Level':
                demo_col = 'income_level'
            else:  # Housing Status
                demo_col = 'housing_status'
            
            # Filter out null values
            filtered_ts_df = time_series_df[time_series_df[demo_col].notna()].copy()
            
            if not filtered_ts_df.empty:
                # Count participants by date and demographic group
                daily_counts = filtered_ts_df.groupby(['join_date', demo_col]).size().reset_index(name='daily_joins')
                
                # Calculate cumulative sums for each demographic group
                cumulative_data = []
                for group in daily_counts[demo_col].unique():
                    group_data = daily_counts[daily_counts[demo_col] == group].sort_values('join_date')
                    group_data['cumulative'] = group_data['daily_joins'].cumsum()
                    group_data['target'] = combined_targets.get(group, 0)
                    group_data['progress_pct'] = (group_data['cumulative'] / group_data['target'] * 100).round(1) if group_data['target'].iloc[0] > 0 else 0
                    cumulative_data.append(group_data)
                
                if cumulative_data:
                    combined_data = pd.concat(cumulative_data, ignore_index=True)
                    
                    # Create time series chart
                    fig = px.line(combined_data, 
                                 x='join_date', 
                                 y='cumulative',
                                 color=demo_col,
                                 title=f'{time_series_category} - Combined Cumulative Participation Over Time',
                                 labels={'join_date': 'Date', 'cumulative': 'Cumulative Participants'})
                    
                    # Add target lines
                    for group in combined_data[demo_col].unique():
                        target_val = combined_targets.get(group, 0)
                        if target_val > 0:
                            fig.add_hline(y=target_val, 
                                        line_dash="dash", 
                                        annotation_text=f"{group} Target: {target_val}",
                                        annotation_position="right")
                    
                    st.plotly_chart(fig, use_container_width=True)
                    
                    # Show progress percentage over time
                    fig2 = px.line(combined_data, 
                                  x='join_date', 
                                  y='progress_pct',
                                  color=demo_col,
                                  title=f'{time_series_category} - Combined Target Progress Percentage Over Time',
                                  labels={'join_date': 'Date', 'progress_pct': 'Progress %'})
                    
                    fig2.add_hline(y=100, line_dash="dash", annotation_text="100% Target")
                    
                    st.plotly_chart(fig2, use_container_width=True)
                else:
                    st.info("No valid data available for selected category.")
            else:
                st.info("No valid data available for selected category after filtering.")
        else:
            st.info("No time series data available.")
            
    else:
        # Load individual participant records for time series analysis
        time_series_query = f'''
        SELECT 
            PARTICIPANT_ID,
            DATE(JOINED_ON) as join_date,
            FIRE_ZONE,
            HOUSING_STATUS, 
            HOUSEHOLD_INCOME_PRETAX, 
            RACE_ETHNICITY,
            CASE UNIFORM(0, 3, RANDOM())
                WHEN 0 THEN '18-24'
                WHEN 1 THEN '25-44'
                WHEN 2 THEN '45-64'
                WHEN 3 THEN '65+'
            END AS AGE_GROUP
        FROM ANALYTICS_ENGCA_PRD.ANALYTICS.PARTICIPANTS
        WHERE STATUS = 'Joined' AND FIRE_ZONE = '{selected_fire_area}'
        ORDER BY JOINED_ON
        '''
        
        time_series_df = session.sql(time_series_query).to_pandas()
        
        if not time_series_df.empty:
            # Apply same data mapping as main dataset
            housing_mapping = {
                'Homeowner': 'Home Owner',
                'Renter': 'Renter',
                'Unhoused': 'Renter',
                "I'd rather not say": None
            }
            time_series_df['housing_status'] = time_series_df['HOUSING_STATUS'].map(housing_mapping)
            
            income_mapping = {
                'Less than $10,000': '<$35000',
                '$15,000 to $24,999': '<$35000', 
                '$35,000 to $49,999': '$35000-75000',
                '$50,000 to $74,999': '$35000-75000',
                '$75,000 to $99,999': '$75000-$150000',
                '$100,000 to $149,999': '$75000-$150000',
                '$150,000 to $199,999': '$150000+',
                '$200,000 or more': '$150000+',
                "I'd rather not say": None
            }
            time_series_df['income_level'] = time_series_df['HOUSEHOLD_INCOME_PRETAX'].map(income_mapping)
            
            # Category selector for time series
            time_series_category = st.selectbox("Select Category for Time Series", 
                                               ['Age', 'Race and Ethnicity', 'Income Level', 'Housing Status'],
                                               key="time_series_category")
            
            # Get targets for selected fire area and category
            targets = DEMOGRAPHIC_TARGETS[selected_fire_area][time_series_category]
            
            # Convert join_date to datetime
            time_series_df['join_date'] = pd.to_datetime(time_series_df['JOIN_DATE'])
            
            # Map demographic category to column name
            if time_series_category == 'Age':
                demo_col = 'AGE_GROUP'
            elif time_series_category == 'Race and Ethnicity':
                demo_col = 'RACE_ETHNICITY'
            elif time_series_category == 'Income Level':
                demo_col = 'income_level'
            else:  # Housing Status
                demo_col = 'housing_status'
            
            # Filter out null values
            filtered_ts_df = time_series_df[time_series_df[demo_col].notna()].copy()
            
            if not filtered_ts_df.empty:
                # Count participants by date and demographic group
                daily_counts = filtered_ts_df.groupby(['join_date', demo_col]).size().reset_index(name='daily_joins')
                
                # Calculate cumulative sums for each demographic group
                cumulative_data = []
                for group in daily_counts[demo_col].unique():
                    group_data = daily_counts[daily_counts[demo_col] == group].sort_values('join_date')
                    group_data['cumulative'] = group_data['daily_joins'].cumsum()
                    group_data['target'] = targets.get(group, 0)
                    group_data['progress_pct'] = (group_data['cumulative'] / group_data['target'] * 100).round(1) if group_data['target'].iloc[0] > 0 else 0
                    cumulative_data.append(group_data)
                
                if cumulative_data:
                    combined_data = pd.concat(cumulative_data, ignore_index=True)
                    
                    # Create time series chart
                    fig = px.line(combined_data, 
                                 x='join_date', 
                                 y='cumulative',
                                 color=demo_col,
                                 title=f'{time_series_category} - Cumulative Participation Over Time',
                                 labels={'join_date': 'Date', 'cumulative': 'Cumulative Participants'})
                    
                    # Add target lines
                    for group in combined_data[demo_col].unique():
                        target_val = targets.get(group, 0)
                        if target_val > 0:
                            fig.add_hline(y=target_val, 
                                        line_dash="dash", 
                                        annotation_text=f"{group} Target: {target_val}",
                                        annotation_position="right")
                    
                    st.plotly_chart(fig, use_container_width=True)
                    
                    # Show progress percentage over time
                    fig2 = px.line(combined_data, 
                                  x='join_date', 
                                  y='progress_pct',
                                  color=demo_col,
                                  title=f'{time_series_category} - Target Progress Percentage Over Time',
                                  labels={'join_date': 'Date', 'progress_pct': 'Progress %'})
                    
                    fig2.add_hline(y=100, line_dash="dash", annotation_text="100% Target")
                    
                    st.plotly_chart(fig2, use_container_width=True)
                else:
                    st.info("No valid data available for selected category.")
            else:
                st.info("No valid data available for selected category after filtering.")
        else:
            st.info("No time series data available.")

# Tab 4: Data Quality
with tab4:
    st.subheader("Data Quality Assessment")
    
    # Overall data quality metrics
    total_participants = len(df)
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Housing Status Data Quality**")
        
        # Housing status breakdown including "I'd rather not say"
        housing_null = df['housing_status'].isna().sum()
        housing_rather_not_say = (df['HOUSING_STATUS'] == "I'd rather not say").sum()
        housing_valid = total_participants - housing_null - housing_rather_not_say
        
        housing_quality_df = pd.DataFrame({
            'Category': ['Valid Responses', 'Null Values', '"I\'d rather not say"'],
            'Count': [housing_valid, housing_null, housing_rather_not_say],
            'Percentage': [
                (housing_valid / total_participants * 100).round(1),
                (housing_null / total_participants * 100).round(1),
                (housing_rather_not_say / total_participants * 100).round(1)
            ]
        })
        
        st.dataframe(housing_quality_df, use_container_width=True, hide_index=True)
        
        # Housing status value distribution
        st.markdown("**Housing Status Distribution**")
        housing_dist = df['HOUSING_STATUS'].value_counts().reset_index()
        housing_dist.columns = ['Housing Status', 'Count']
        st.dataframe(housing_dist, use_container_width=True, hide_index=True)
    
    with col2:
        st.markdown("**Income Data Quality**")
        
        # Income breakdown including "I'd rather not say"
        income_null = df['income_level'].isna().sum()
        income_rather_not_say = (df['HOUSEHOLD_INCOME_PRETAX'] == "I'd rather not say").sum()
        income_valid = total_participants - income_null - income_rather_not_say
        
        income_quality_df = pd.DataFrame({
            'Category': ['Valid Responses', 'Null Values', '"I\'d rather not say"'],
            'Count': [income_valid, income_null, income_rather_not_say],
            'Percentage': [
                (income_valid / total_participants * 100).round(1),
                (income_null / total_participants * 100).round(1),
                (income_rather_not_say / total_participants * 100).round(1)
            ]
        })
        
        st.dataframe(income_quality_df, use_container_width=True, hide_index=True)
        
        # Income value distribution
        st.markdown("**Income Distribution**")
        income_dist = df['HOUSEHOLD_INCOME_PRETAX'].value_counts().reset_index()
        income_dist.columns = ['Income Level', 'Count']
        st.dataframe(income_dist, use_container_width=True, hide_index=True)
    
    # Race/ethnicity and age quality
    st.markdown("**Race/Ethnicity and Age Data Quality**")
    
    col1, col2 = st.columns(2)
    
    with col1:
        race_dist = df['race_ethnicity'].value_counts().reset_index()
        race_dist.columns = ['Race/Ethnicity', 'Count']
        st.dataframe(race_dist, use_container_width=True, hide_index=True)
    
    with col2:
        age_dist = df['age_group'].value_counts().reset_index()
        age_dist.columns = ['Age Group', 'Count']
        st.dataframe(age_dist, use_container_width=True, hide_index=True)
    
    # Fire area distribution
    st.markdown("**Fire Area Distribution**")
    fire_dist = df['fire_area'].value_counts().reset_index()
    fire_dist.columns = ['Fire Area', 'Count']
    st.dataframe(fire_dist, use_container_width=True, hide_index=True)
with tab3:
    st.subheader("Data Export")
    
    if selected_fire_area != 'All':
        fire_area = selected_fire_area
        targets = DEMOGRAPHIC_TARGETS[fire_area]
        counts = current_counts.get(fire_area, {})
        
        progress_df = calculate_progress(counts, targets)
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("**Export Progress Data**")
            csv_progress = progress_df.to_csv(index=False)
            st.download_button(
                label="Download Progress Report",
                data=csv_progress,
                file_name=f"{fire_area.replace(' ', '_')}_progress_report.csv",
                mime="text/csv",
                use_container_width=True
            )
        
        with col2:
            st.markdown("**Export Participant Data**")
            csv_participants = filtered_df.to_csv(index=False)
            st.download_button(
                label="Download Participant Data",
                data=csv_participants,
                file_name=f"{fire_area.replace(' ', '_')}_participants.csv",
                mime="text/csv",
                use_container_width=True
            )
        
        # Preview of export data
        st.subheader("Data Preview")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("**Progress Report Preview**")
            st.dataframe(progress_df.head(10), use_container_width=True)
        
        with col2:
            st.markdown("**Participant Data Preview**")
            st.dataframe(filtered_df.head(10), use_container_width=True)
    
    else:
        st.info("Please select a specific fire area to export data.")

# Tab 6: Target Reference
with tab6:
    st.subheader("Demographic Target Reference")
    
    st.markdown("""
    **Background:** These target numbers represent the minimum number of participants recommended 
    to reflect the demographic representation of each group in each fire area's population. 
    The numbers are based on a goal to engage at least 1,000 participants per fire area, 
    adjusted for an expected 40% response rate to demographics questions.
    """)
        
    # Display targets for both fire areas
    for fire_area, targets in DEMOGRAPHIC_TARGETS.items():
        with st.expander(f"{fire_area} Targets", expanded=True):
            
            # Create columns for each demographic category
            cols = st.columns(len(targets))
            
            for idx, (category, groups) in enumerate(targets.items()):
                with cols[idx]:
                    st.markdown(f"**{category}**")
                    
                    # Create DataFrame for this category
                    category_df = pd.DataFrame([
                        {'Group': group, 'Target': target} 
                        for group, target in groups.items()
                    ])
                    
                    st.dataframe(category_df, use_container_width=True, hide_index=True)