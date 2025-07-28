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
FROM ANALYTICS_ENGCA_PRD.ETHELO_LA_DELIBERATION.PARTICIPANTS
WHERE STATUS = 'Joined' AND EVACUATION_ZONE IN ('Eaton','Palisades','Other')
'''
data_info = session.sql(data_info_query).to_pandas()

# Fire area breakdown query
fire_breakdown_query = '''
SELECT
    EVACUATION_ZONE,
    COUNT(*) as participants
FROM ANALYTICS_ENGCA_PRD.ETHELO_LA_DELIBERATION.PARTICIPANTS
WHERE STATUS = 'Joined' AND EVACUATION_ZONE IN ('Eaton','Palisades','Other')
GROUP BY EVACUATION_ZONE
'''
#
fire_breakdown = session.sql(fire_breakdown_query).to_pandas()

if not data_info.empty:
    col1, col2, col3, col4, col5 = st.columns(5)

    with col1:
        st.metric("Total Participants", data_info.iloc[0]['TOTAL_PARTICIPANTS'])

    with col2:
        palisades_count = fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Palisades']['PARTICIPANTS'].iloc[0] if len(fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Palisades']) > 0 else 0
        st.metric("Palisades Participants", palisades_count)

    with col3:
        eaton_count = fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Eaton']['PARTICIPANTS'].iloc[0] if len(fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Eaton']) > 0 else 0
        st.metric("Eaton Participants", eaton_count)

    with col4:
        other_count = fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Other']['PARTICIPANTS'].iloc[0] if len(fire_breakdown[fire_breakdown['EVACUATION_ZONE'] == 'Other']) > 0 else 0
        st.metric("Other Participants", other_count)

    with col5:
        latest_date = data_info.iloc[0]['LATEST_JOIN_DATE']
        if latest_date and pd.notna(latest_date):
            st.metric("Latest Join Date", latest_date.strftime('%Y-%m-%d'))
        else:
            st.metric("Latest Join Date", "No data")

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
    FROM ANALYTICS_ENGCA_PRD.ETHELO_LA_DELIBERATION.DELIBERATION_DEMO_TARGETS
    WHERE demographic_category != 'Housing Status'
    ORDER BY fire_area, demographic_category, demographic_group
    '''

    targets_df = session.sql(query).to_pandas()

    # Income mapping from old format to new format
    income_format_mapping = {
        '<$35000': 'Less than $35,000',
        '$35000-75000': '$35,000 - 75,000',
        '$75000-$150000': '$75,000 - 150,000',
        '$150000+': 'Greater than $150,000'
    }

    # Convert to nested dictionary structure for compatibility with existing code
    targets_dict = {}

    for _, row in targets_df.iterrows():
        fire_area = row['FIRE_AREA']
        category = row['DEMOGRAPHIC_CATEGORY']
        group = row['DEMOGRAPHIC_GROUP']
        target = row['TARGET_COUNT']

        # Map old income format to new format
        if category == 'Income Level' and group in income_format_mapping:
            group = income_format_mapping[group]

        if fire_area not in targets_dict:
            targets_dict[fire_area] = {}

        if category not in targets_dict[fire_area]:
            targets_dict[fire_area][category] = {}

        targets_dict[fire_area][category][group] = target

    return targets_dict

# Load demographic targets from database
DEMOGRAPHIC_TARGETS = load_demographic_targets()

# Global income mapping
INCOME_MAPPING = {
    'Less than $35,000': 'Less than $35,000',
    '$35,000 - 75,000': '$35,000 - 75,000',
    '$75,000 - 150,000': '$75,000 - 150,000',
    'Greater than $150,000': 'Greater than $150,000',
    "I'd rather not say": None
}

# Load actual participant data from database
@st.cache_data
def load_participant_data():
    """Load actual participant data from the database"""
    query = '''
    SELECT
        PARTICIPANT_ID,
        STATUS,
        JOINED_ON,
        EVACUATION_ZONE,
        INCOME,
        RACE_ETHNICITY_ARRAY,
        AGE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_LA_DELIBERATION.PARTICIPANTS
    WHERE STATUS = 'Joined' AND EVACUATION_ZONE IN ('Eaton','Palisades','Other')
    '''

    df = session.sql(query).to_pandas()

    # Standardize column names and values to match targets
    df['fire_area'] = df['EVACUATION_ZONE']
    df['age_group'] = df['AGE']
    df['status'] = df['STATUS']
    df['participant_id'] = df['PARTICIPANT_ID']
    df['income_level'] = df['INCOME'].map(INCOME_MAPPING)

    return df

# Function to process race/ethnicity array data
def process_race_ethnicity_data(df):
    """Process the race/ethnicity array to create individual records for each category"""
    race_records = []

    for _, row in df.iterrows():
        if row['RACE_ETHNICITY_ARRAY'] and pd.notna(row['RACE_ETHNICITY_ARRAY']):
            try:
                if isinstance(row['RACE_ETHNICITY_ARRAY'], str):
                    race_array = eval(row['RACE_ETHNICITY_ARRAY']) if row['RACE_ETHNICITY_ARRAY'].startswith('[') else [row['RACE_ETHNICITY_ARRAY']]
                else:
                    race_array = row['RACE_ETHNICITY_ARRAY']

                # Handle "I'd rather not say" - include it in distribution (with curly apostrophe)
                if race_array == ["I'd rather not say"]:
                    race_records.append({
                        'participant_id': row['participant_id'],
                        'fire_area': row['fire_area'],
                        'race_ethnicity': "I'd rather not say",
                        'age_group': row['age_group'],
                        'income_level': row['income_level'],
                        'status': row['status']
                    })
                else:
                    for race in race_array:
                        if race:
                            race_records.append({
                                'participant_id': row['participant_id'],
                                'fire_area': row['fire_area'],
                                'race_ethnicity': race,
                                'age_group': row['age_group'],
                                'income_level': row['income_level'],
                                'status': row['status']
                            })
            except:
                pass

    return pd.DataFrame(race_records)

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

# Helper function to combine data from all fire areas
def get_combined_data(filtered_df, filtered_race_df):
    """Get combined targets and counts for all fire areas"""
    # Combine targets from fire areas that have targets (exclude 'Other')
    combined_targets = {}
    for fire_area, targets in DEMOGRAPHIC_TARGETS.items():
        for category, groups in targets.items():
            if category not in combined_targets:
                combined_targets[category] = {}
            for group, target in groups.items():
                combined_targets[category][group] = combined_targets[category].get(group, 0) + target

    # Combine current counts from fire areas with targets only
    combined_counts = {}
    for fire_area in DEMOGRAPHIC_TARGETS.keys():
        area_data = filtered_df[filtered_df['fire_area'] == fire_area]
        area_race_data = filtered_race_df[filtered_race_df['fire_area'] == fire_area]
        area_counts = {
            'Age': area_data['age_group'].value_counts().to_dict(),
            'Race and Ethnicity': area_race_data['race_ethnicity'].value_counts().to_dict(),
            'Income Level': area_data['income_level'].dropna().value_counts().to_dict()
        }

        for category, groups in area_counts.items():
            if category not in combined_counts:
                combined_counts[category] = {}
            for group, count in groups.items():
                combined_counts[category][group] = combined_counts[category].get(group, 0) + count

    return combined_targets, combined_counts

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

# Helper function to calculate current counts
def calculate_current_counts(filtered_df, filtered_race_df, selected_fire_area):
    """Calculate current counts by demographic categories"""
    current_counts = {}
    for fire_area in DEMOGRAPHIC_TARGETS.keys():
        if selected_fire_area == 'All' or selected_fire_area == fire_area:
            area_data = filtered_df[filtered_df['fire_area'] == fire_area] if selected_fire_area == 'All' else filtered_df
            area_race_data = filtered_race_df[filtered_race_df['fire_area'] == fire_area] if selected_fire_area == 'All' else filtered_race_df

            current_counts[fire_area] = {
                'Age': area_data['age_group'].value_counts().to_dict(),
                'Race and Ethnicity': area_race_data['race_ethnicity'].value_counts().to_dict(),
                'Income Level': area_data['income_level'].dropna().value_counts().to_dict()
            }
    return current_counts

# Load participant data
df = load_participant_data()

# Process race/ethnicity data
race_df = process_race_ethnicity_data(df)

# Sidebar filters
st.sidebar.header("Filters")

# Fire area filter
fire_area_options = ['All'] + sorted(df['fire_area'].unique().tolist())
selected_fire_area = st.sidebar.selectbox("Fire Area", fire_area_options)

# Apply filters
filtered_df = df.copy()
filtered_race_df = race_df.copy()

if selected_fire_area != 'All':
    filtered_df = filtered_df[filtered_df['fire_area'] == selected_fire_area]
    filtered_race_df = filtered_race_df[filtered_race_df['fire_area'] == selected_fire_area]

# Calculate current counts by demographic categories
current_counts = calculate_current_counts(filtered_df, filtered_race_df, selected_fire_area)

# Create tabs
tab1, tab2, tab3, tab4, tab5 = st.tabs(["Progress Overview", "Time Series", "Data Quality", "Data Export", "Target Reference"])

# Tab 1: Progress Overview
with tab1:
    st.subheader("Overall Progress Summary")

    if selected_fire_area == 'All':
        # Show combined progress for all fire areas
        st.markdown("### Combined Progress Across All Fire Areas")
        combined_targets, combined_counts = get_combined_data(filtered_df, filtered_race_df)
        progress_df = calculate_progress(combined_counts, combined_targets)

        # Summary metrics for combined data
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            # Use Age category targets as the total (each person is in exactly one age group)
            total_target = sum(combined_targets.get('Age', {}).values())
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
                # Use Age category as the total target (each person is in exactly one age group)
                area_total_target = sum(area_targets.get('Age', {}).values())
                st.metric(f"{fire_area} Participants", area_participant_count, f"Target: {area_total_target}")

    else:
        # Show progress for selected fire area
        fire_area = selected_fire_area

        if fire_area in DEMOGRAPHIC_TARGETS:
            # Fire area has targets - show full progress tracking
            targets = DEMOGRAPHIC_TARGETS[fire_area]
            counts = current_counts.get(fire_area, {})
            progress_df = calculate_progress(counts, targets)

            # Summary metrics
            col1, col2, col3, col4 = st.columns(4)

            with col1:
                # Use Age category targets as the total (each person is in exactly one age group)
                total_target = sum(targets.get('Age', {}).values())
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

            # Progress by category charts
            st.subheader("Progress by Demographic Category")
            categories = ['Age', 'Race and Ethnicity', 'Income Level']

            for category in categories:
                with st.expander(f"{category} Progress", expanded=category in ['Age', 'Race and Ethnicity']):
                    fig = create_progress_chart(progress_df, category)
                    st.plotly_chart(fig, use_container_width=True, key=f"overview_{category.replace(' ', '_').lower()}")

                    # Show detailed table
                    category_progress = progress_df[progress_df['Category'] == category].copy()
                    category_progress['% of Target'] = (category_progress['Current'] / category_progress['Target'] * 100).round(1)

                    display_columns = ['Group', 'Target', 'Current', '% of Target', 'Gap', 'Status']
                    st.dataframe(category_progress[display_columns], use_container_width=True, hide_index=True)
        else:
            # Fire area has no targets - show current counts only
            st.info(f"**{fire_area}** evacuation zone participants are included in the data but do not have demographic targets.")

            # Summary metrics - just current counts
            col1, col2 = st.columns(2)

            with col1:
                total_current = len(filtered_df)
                st.metric("Total Participants", total_current)

            with col2:
                st.metric("Demographic Targets", "None Available")

            # Show current demographic breakdown without targets
            st.subheader("Current Demographic Distribution")

            # Calculate current counts for this fire area
            area_data = filtered_df[filtered_df['fire_area'] == fire_area]
            area_race_data = filtered_race_df[filtered_race_df['fire_area'] == fire_area]

            categories = ['Age', 'Race and Ethnicity', 'Income Level']

            for category in categories:
                with st.expander(f"{category} Distribution", expanded=category in ['Age', 'Race and Ethnicity']):

                    if category == 'Age':
                        counts_data = area_data['age_group'].value_counts().reset_index()
                        counts_data.columns = ['Group', 'Current']
                    elif category == 'Race and Ethnicity':
                        counts_data = area_race_data['race_ethnicity'].value_counts().reset_index()
                        counts_data.columns = ['Group', 'Current']
                    else:  # Income Level
                        counts_data = area_data['income_level'].dropna().value_counts().reset_index()
                        counts_data.columns = ['Group', 'Current']

                    if not counts_data.empty:
                        # Simple bar chart showing current counts only
                        fig = go.Figure()
                        fig.add_trace(go.Bar(
                            name='Current',
                            x=counts_data['Group'],
                            y=counts_data['Current'],
                            marker_color='steelblue'
                        ))

                        fig.update_layout(
                            title=f'{category} - Current Participation',
                            xaxis_title='Groups',
                            yaxis_title='Number of Participants',
                            height=400
                        )

                        st.plotly_chart(fig, use_container_width=True, key=f"overview_no_targets_{category.replace(' ', '_').lower()}")

                        # Show counts table
                        st.dataframe(counts_data, use_container_width=True, hide_index=True)
                    else:
                        st.info(f"No data available for {category}")

# Tab 2: Time Series
with tab2:
    st.subheader("Progress Over Time")

    # Load time series data
    time_series_query = f'''
    SELECT
        PARTICIPANT_ID,
        DATE(JOINED_ON) as join_date,
        EVACUATION_ZONE,
        INCOME,
        RACE_ETHNICITY_ARRAY,
        AGE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_LA_DELIBERATION.PARTICIPANTS
    WHERE STATUS = 'Joined' AND EVACUATION_ZONE IN ('Eaton','Palisades','Other')
    {f"AND EVACUATION_ZONE = '{selected_fire_area}'" if selected_fire_area != 'All' else ''}
    ORDER BY JOINED_ON
    '''

    time_series_df = session.sql(time_series_query).to_pandas()

    if not time_series_df.empty:
        # Apply data mapping
        time_series_df['income_level'] = time_series_df['INCOME'].map(INCOME_MAPPING)
        time_series_df['join_date'] = pd.to_datetime(time_series_df['JOIN_DATE'])

        # Category selector for time series
        time_series_category = st.selectbox("Select Category for Time Series",
                                           ['Age', 'Race and Ethnicity', 'Income Level'],
                                           key="time_series_category")

        # Get targets for selected category
        if selected_fire_area == 'All':
            combined_targets, _ = get_combined_data(filtered_df, filtered_race_df)
            targets = combined_targets[time_series_category]
        elif selected_fire_area in DEMOGRAPHIC_TARGETS:
            targets = DEMOGRAPHIC_TARGETS[selected_fire_area][time_series_category]
        else:
            # No targets for this fire area (e.g., 'Other')
            targets = {}

        # Process data based on category
        if time_series_category == 'Race and Ethnicity':
            # Handle race/ethnicity array
            race_time_records = process_race_ethnicity_data(time_series_df)
            if not race_time_records.empty:
                race_time_records['join_date'] = pd.to_datetime(time_series_df.set_index('PARTICIPANT_ID').loc[race_time_records['participant_id'], 'JOIN_DATE'].values)
                daily_counts = race_time_records.groupby(['join_date', 'race_ethnicity']).size().reset_index(name='daily_joins')
                demo_col = 'race_ethnicity'
            else:
                st.info("No valid race/ethnicity data available.")
                daily_counts = pd.DataFrame()
        else:
            # Handle Age and Income
            demo_col = 'AGE' if time_series_category == 'Age' else 'income_level'
            filtered_ts_df = time_series_df[time_series_df[demo_col].notna()].copy()

            if not filtered_ts_df.empty:
                daily_counts = filtered_ts_df.groupby(['join_date', demo_col]).size().reset_index(name='daily_joins')
            else:
                st.info(f"No valid {time_series_category.lower()} data available.")
                daily_counts = pd.DataFrame()

        # Create time series charts if we have data
        if not daily_counts.empty:
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

                # Create cumulative participation chart
                area_label = f" - {selected_fire_area}" if selected_fire_area != 'All' else " - Combined"
                fig = px.line(combined_data,
                             x='join_date',
                             y='cumulative',
                             color=demo_col,
                             title=f'{time_series_category}{area_label} - Cumulative Participation Over Time',
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

                # Create progress percentage chart
                fig2 = px.line(combined_data,
                              x='join_date',
                              y='progress_pct',
                              color=demo_col,
                              title=f'{time_series_category}{area_label} - Target Progress Percentage Over Time',
                              labels={'join_date': 'Date', 'progress_pct': 'Progress %'})

                fig2.add_hline(y=100, line_dash="dash", annotation_text="100% Target")
                st.plotly_chart(fig2, use_container_width=True)
    else:
        st.info("No time series data available.")

# Tab 3: Data Quality
with tab3:
    st.subheader("Data Quality Assessment")

    # Overall data quality metrics
    total_participants = len(filtered_df)  # Use filtered data

    # # DEBUG INFO - Remove this later
    # st.write(f"DEBUG: Total participants in filtered data: {total_participants}")
    # st.write(f"DEBUG: Total participants in full data: {len(df)}")
    # st.write(f"""DEBUG: Income 'I'd rather not say' in filtered data: {(filtered_df['INCOME'] == "I’d rather not say").sum()}""")
    # st.write(f"""DEBUG: Age 'I’d rather not say' in filtered data: {(filtered_df['AGE'] == "I’d rather not say").sum()}""")

    # # Let's see what the actual unique values are
    # st.write("DEBUG: Unique Income values:")
    # st.text(filtered_df['INCOME'].unique())
    # st.write("DEBUG: Unique Age values:")
    # st.text(filtered_df['AGE'].unique())

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("**Income Data Quality**")
        income_rather_not_say = (filtered_df['INCOME'] == "I’d rather not say").sum()
        income_null = filtered_df['INCOME'].isna().sum()
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
        income_dist = filtered_df['INCOME'].value_counts().reset_index()
        income_dist.columns = ['Income Level', 'Count']
        st.dataframe(income_dist, use_container_width=True, hide_index=True)

    with col2:
        st.markdown("**Age Data Quality**")
        age_rather_not_say = (filtered_df['AGE'] == "I’d rather not say").sum()
        age_null = filtered_df['AGE'].isna().sum()
        age_valid = total_participants - age_null - age_rather_not_say

        age_quality_df = pd.DataFrame({
            'Category': ['Valid Responses', 'Null Values', '"I\'d rather not say"'],
            'Count': [age_valid, age_null, age_rather_not_say],
            'Percentage': [
                (age_valid / total_participants * 100).round(1),
                (age_null / total_participants * 100).round(1),
                (age_rather_not_say / total_participants * 100).round(1)
            ]
        })

        st.dataframe(age_quality_df, use_container_width=True, hide_index=True)

        # Age value distribution
        st.markdown("**Age Distribution**")
        age_dist = filtered_df['AGE'].value_counts().reset_index()
        age_dist.columns = ['Age Group', 'Count']
        st.dataframe(age_dist, use_container_width=True, hide_index=True)

    # Race/ethnicity quality
    st.markdown("**Race/Ethnicity Data Quality**")

    # Function to check if race/ethnicity array contains only "I'd rather not say"
    def is_race_rather_not_say(x):
        if pd.isna(x):
            return False
        try:
            if isinstance(x, str):
                parsed = eval(x) if x.startswith('[') else [x]
                return parsed == ["I'd rather not say"]  # curly apostrophe
            else:
                return x == ["I'd rather not say"]  # curly apostrophe
        except:
            return False

    race_rather_not_say = filtered_df['RACE_ETHNICITY_ARRAY'].apply(is_race_rather_not_say).sum()
    race_null = filtered_df['RACE_ETHNICITY_ARRAY'].isna().sum()
    race_valid = total_participants - race_null - race_rather_not_say

    race_quality_df = pd.DataFrame({
        'Category': ['Valid Responses', 'Null Values', '"I\'d rather not say"'],
        'Count': [race_valid, race_null, race_rather_not_say],
        'Percentage': [
            (race_valid / total_participants * 100).round(1),
            (race_null / total_participants * 100).round(1),
            (race_rather_not_say / total_participants * 100).round(1)
        ]
    })

    st.dataframe(race_quality_df, use_container_width=True, hide_index=True)

    # Race/ethnicity distribution (from processed data)
    st.markdown("**Race/Ethnicity Distribution (Individual Categories)**")
    if not filtered_race_df.empty:
        race_dist = filtered_race_df['race_ethnicity'].value_counts().reset_index()
        race_dist.columns = ['Race/Ethnicity', 'Count']
        st.dataframe(race_dist, use_container_width=True, hide_index=True)
        st.info(f"Total individual race/ethnicity responses ({race_dist['Count'].sum()}) may exceed participant count due to multiple selections.")

    # Fire area distribution
    st.markdown("**Fire Area Distribution**")
    fire_dist = filtered_df['fire_area'].value_counts().reset_index()
    fire_dist.columns = ['Fire Area', 'Count']
    st.dataframe(fire_dist, use_container_width=True, hide_index=True)

# Tab 4: Data Export
with tab4:
    st.subheader("Data Export")

    if selected_fire_area == 'All':
        # Export combined data for all fire areas
        st.markdown("### Export Combined Data")

        # Create progress report for areas with targets
        all_progress_data = []
        for fire_area in DEMOGRAPHIC_TARGETS.keys():
            if fire_area in current_counts:
                fire_progress = calculate_progress(current_counts[fire_area], DEMOGRAPHIC_TARGETS[fire_area])
                fire_progress['Fire_Area'] = fire_area
                all_progress_data.append(fire_progress)

        if all_progress_data:
            combined_progress_df = pd.concat(all_progress_data, ignore_index=True)
        else:
            combined_progress_df = pd.DataFrame()

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("**Export Combined Progress Data**")
            if not combined_progress_df.empty:
                csv_progress = combined_progress_df.to_csv(index=False)
                st.download_button(
                    label="Download Combined Progress Report",
                    data=csv_progress,
                    file_name="combined_progress_report.csv",
                    mime="text/csv",
                    use_container_width=True
                )
            else:
                st.info("No progress data available (no targets defined)")

        with col2:
            st.markdown("**Export Combined Participant Data**")
            csv_participants = filtered_df.to_csv(index=False)
            st.download_button(
                label="Download Combined Participant Data",
                data=csv_participants,
                file_name="combined_participants.csv",
                mime="text/csv",
                use_container_width=True
            )

        # Preview of export data
        st.subheader("Data Preview")

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("**Progress Report Preview**")
            if not combined_progress_df.empty:
                st.dataframe(combined_progress_df.head(10), use_container_width=True)
            else:
                st.info("No progress data available")

        with col2:
            st.markdown("**Participant Data Preview**")
            st.dataframe(filtered_df.head(10), use_container_width=True)

    else:
        # Export data for specific fire area
        st.markdown(f"### Export Data for {selected_fire_area}")

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("**Export Progress Data**")
            if selected_fire_area in DEMOGRAPHIC_TARGETS and selected_fire_area in current_counts:
                # Has targets - create progress report
                targets = DEMOGRAPHIC_TARGETS[selected_fire_area]
                counts = current_counts.get(selected_fire_area, {})
                progress_df = calculate_progress(counts, targets)

                csv_progress = progress_df.to_csv(index=False)
                st.download_button(
                    label="Download Progress Report",
                    data=csv_progress,
                    file_name=f"{selected_fire_area.replace(' ', '_')}_progress_report.csv",
                    mime="text/csv",
                    use_container_width=True
                )
            else:
                # No targets - create basic demographic summary
                area_data = filtered_df[filtered_df['fire_area'] == selected_fire_area]
                area_race_data = filtered_race_df[filtered_race_df['fire_area'] == selected_fire_area]

                summary_data = []

                # Age summary
                age_counts = area_data['age_group'].value_counts()
                for group, count in age_counts.items():
                    summary_data.append({'Category': 'Age', 'Group': group, 'Current': count})

                # Race/ethnicity summary
                race_counts = area_race_data['race_ethnicity'].value_counts()
                for group, count in race_counts.items():
                    summary_data.append({'Category': 'Race and Ethnicity', 'Group': group, 'Current': count})

                # Income summary
                income_counts = area_data['income_level'].dropna().value_counts()
                for group, count in income_counts.items():
                    summary_data.append({'Category': 'Income Level', 'Group': group, 'Current': count})

                summary_df = pd.DataFrame(summary_data)

                if not summary_df.empty:
                    csv_summary = summary_df.to_csv(index=False)
                    st.download_button(
                        label="Download Demographic Summary",
                        data=csv_summary,
                        file_name=f"{selected_fire_area.replace(' ', '_')}_demographic_summary.csv",
                        mime="text/csv",
                        use_container_width=True
                    )
                else:
                    st.info("No demographic data available for export")

        with col2:
            st.markdown("**Export Participant Data**")
            csv_participants = filtered_df.to_csv(index=False)
            st.download_button(
                label="Download Participant Data",
                data=csv_participants,
                file_name=f"{selected_fire_area.replace(' ', '_')}_participants.csv",
                mime="text/csv",
                use_container_width=True
            )

        # Preview of export data
        st.subheader("Data Preview")

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("**Export Data Preview**")
            if selected_fire_area in DEMOGRAPHIC_TARGETS and selected_fire_area in current_counts:
                targets = DEMOGRAPHIC_TARGETS[selected_fire_area]
                counts = current_counts.get(selected_fire_area, {})
                progress_df = calculate_progress(counts, targets)
                st.dataframe(progress_df.head(10), use_container_width=True)
            else:
                # Show demographic summary
                area_data = filtered_df[filtered_df['fire_area'] == selected_fire_area]
                area_race_data = filtered_race_df[filtered_race_df['fire_area'] == selected_fire_area]

                summary_data = []

                # Age summary
                age_counts = area_data['age_group'].value_counts()
                for group, count in age_counts.items():
                    summary_data.append({'Category': 'Age', 'Group': group, 'Current': count})

                # Race/ethnicity summary
                race_counts = area_race_data['race_ethnicity'].value_counts()
                for group, count in race_counts.items():
                    summary_data.append({'Category': 'Race and Ethnicity', 'Group': group, 'Current': count})

                # Income summary
                income_counts = area_data['income_level'].dropna().value_counts()
                for group, count in income_counts.items():
                    summary_data.append({'Category': 'Income Level', 'Group': group, 'Current': count})

                summary_df = pd.DataFrame(summary_data)

                if not summary_df.empty:
                    st.dataframe(summary_df.head(10), use_container_width=True)
                else:
                    st.info("No demographic data available")

        with col2:
            st.markdown("**Participant Data Preview**")
            st.dataframe(filtered_df.head(10), use_container_width=True)

# Tab 5: Target Reference
with tab5:
    st.subheader("Demographic Target Reference")

    st.markdown("""
    **Background:** These target numbers represent the minimum number of participants recommended
    to reflect the demographic representation of each group in each fire area's population.
    The numbers are based on a goal to engage at least 1,000 participants per fire area,
    adjusted for an expected 40% response rate to demographics questions.

    Note: 'Other' evacuation zone participants are included in the dashboard but do not have demographic targets.
    """)

    # Display targets for all fire areas
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
