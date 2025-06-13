# Import python packages
import streamlit as st
from snowflake.snowpark.context import get_active_session
import pandas as pd
import plotly.express as px
import numpy as np
import pydeck as pdk
from shapely import wkt
from shapely.geometry import mapping

# Configuration settings
ENABLE_CUSTOM_PROMPT = True  # Set to True to enable custom prompt option for certain users

# Define model costs (dollars per 1 million tokens)
MODEL_COSTS = {
    'claude-3-5-sonnet': 10.0725,
    'snowflake-llama-3.1-405b': 3.792,
    'snowflake-llama-3.3-70b': 1.1455
}

# Helper function to apply filter with "No Response" handling
def apply_filter_with_nulls(df, column, selected_values):
    if not selected_values:
        return df
    
    # Check if "No Response" is in the selected values
    if 'No Response' in selected_values:
        # Get the other selected values (excluding "No Response")
        other_values = [v for v in selected_values if v != 'No Response']
        # Create the filter condition: either the column is in the other values OR it's null
        if other_values:
            filter_condition = df[column].isin(other_values) | df[column].isna()
        else:
            filter_condition = df[column].isna()
    else:
        # No "No Response" selected, just filter by the selected values
        filter_condition = df[column].isin(selected_values)
    
    # Apply the filter
    return df[filter_condition]

session = get_active_session()

# Set page configuration
st.set_page_config(page_title="Demo- Survey Data Overview", layout="wide")

# Page title
st.header("Engaged California: LA Recovery - Agenda Setting")


# Function to get the last update date
@st.cache_data
def get_last_update_date():
    result = session.sql('''SELECT * from ANALYTICS_ENGCA_PRD.ETHELO.LAST_UPDATE_DATE''').collect()
    
    if result and len(result) > 0:
        return result[0]['LATEST_DATE']
    else:
        return None


# Add last update date as subtitle
last_update = get_last_update_date()
if last_update:
    st.caption(f"Last updated: {last_update.strftime('%B %d, %Y at %I:%M %p PT')}")



# Load the survey data
@st.cache_data
def load_data():
    df = session.sql('''SELECT * FROM ANALYTICS_ENGCA_PRD.ETHELO.PARTICIPANTS''').to_pandas()
    return df


# Load the comments data
@st.cache_data
def load_comments_data():
    comments_df = session.sql('''
    select 
    POSTED_BY_ID as PARTICIPANT_ID
    ,count(*) as num_comments
    ,sum(reply_count) as num_replies
    ,sum(flag_count) as num_flags
    ,sum(like_count) as num_likes
    from  ANALYTICS_ENGCA_PRD.ETHELO.COMMENTS
    group by 1
    ''').to_pandas()
    
    return comments_df



# Function to load comment analysis based on filtered participant IDs, selected topics, LLM, and optional custom prompt
@st.cache_data
def load_comment_analysis(participant_ids, selected_topics, selected_llm, custom_prompt=None):
    # Convert the list of participant IDs to a SQL-friendly string format
    if not participant_ids:
        participant_ids_str = "''"  # Empty string for SQL query if no participants
    else:
        participant_ids_str = "'" + "','".join(participant_ids) + "'"
    
    # Convert the list of topics to a SQL-friendly string format
    topics_str = "'" + "','".join(selected_topics) + "'"
    
    # System prompt that provides background context and output format
    system_prompt = '''You are analyzing comments from people impacted by recent wildfires in Los Angeles county (the Eaton Fire in Altadena and the Palisades fire in Pacific Palisades). These wildfires caused significant damage, and thousands of people lost their homes and are now displaced, dealing with recovery issues like cleanup and insurance claims. 

You will receive comments that are semi-colon separated and relate to multiple topics. The topics will be specified at the beginning of the user message.

Always format your response in Markdown. Use headers, bullet points, and other markdown formatting to make your analysis clear and readable.
IMPORTANT: your response should be no more than 3000 words.'''
    
    # Default user prompt template (without topic reference as it's handled separately)
    default_user_prompt = '''Perform an open-coding analysis on these comments and identify 3–6 emerging themes.

Your output should follow this general format for each theme:

#### [Theme number]. [Theme Label] 

*Description: [Theme description]*

*Representative quotes:*
    
    - [At least three representative, strictly verbatim quotes (use ellipses [...] to trim irrelevant parts). Choose quotes that are highly representative, clear, and distinctive.]'''
    
    # Use custom prompt if provided, otherwise use default
    user_prompt_template = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else default_user_prompt
    # Create the SQL query to combine all topics
    query = f'''
    with combined_comments as (
        -- First source: COMMENTS
        select 
            POSTED_BY_ID as PARTICIPANT_ID,
            Target,
            SUBSTRING(CONTENT, 1, 500) as CONTENT_SUBSTRING
        from ANALYTICS_ENGCA_PRD.ETHELO.COMMENTS 
        where POSTED_BY_ID in ({participant_ids_str})
        and trim(target) in ({topics_str})
        
        UNION ALL
        
        -- Second source: PARTICIPANT_PERSPECTIVE_AND_PRIORITY
        select 
            PARTICIPANT as PARTICIPANT_ID,
            TARGET,
            SUBSTRING(CONTENT, 1, 500) as CONTENT_SUBSTRING
        from ANALYTICS_ENGCA_PRD.ETHELO.PARTICIPANT_PERSPECTIVE_AND_PRIORITY
        where PARTICIPANT in ({participant_ids_str})
        and trim(TARGET) in ({topics_str})
    ),
    topic_list_agg as (
        select 
            LISTAGG(DISTINCT Target, ', ') as topic_list
        from combined_comments
    ),
    all_comments_agg as (
        select 
            'All Selected Topics' as topics,
            count(*) as n,
            LISTAGG(Target || ': ' || CONTENT_SUBSTRING, '; ') as target_comments 
        from combined_comments
    )
    select
        a.topics,
        t.topic_list,
        a.n,
        len(a.target_comments) as n_char,
        SNOWFLAKE.CORTEX.COMPLETE(
            '{selected_llm}', 
            ARRAY_CONSTRUCT(
                OBJECT_CONSTRUCT('role', 'system', 'content', '{system_prompt}'),
                OBJECT_CONSTRUCT('role', 'user', 'content', CONCAT('Topics: ', t.topic_list, '\\n\\n', '{user_prompt_template}', '\\n\\nComments:\\n', a.target_comments))
            ),
            OBJECT_CONSTRUCT('temperature', 0)
        ) as desc_raw
    from all_comments_agg a
    cross join topic_list_agg t
    '''
    
    
    # Execute the query
    try:
        analysis_df = session.sql(query).to_pandas()
        return analysis_df
    except Exception as e:
        st.error(f"Error executing comment analysis query: {e}")
        return pd.DataFrame(columns=['TOPICS', 'TOPIC_LIST', 'N', 'N_CHAR', 'DESC_RAW'])




# Load race/ethnicity data
@st.cache_data
def load_race_ethnicity_data():
    race_df = session.sql('''
    select * from RACE_ETHNICITY_ALONE_OR_COMBO
    ''').to_pandas()
    
    return race_df

# --- Map Data Loading Functions ---
@st.cache_data
def load_fire_perimeters():
    """Loads fire perimeter data from Snowflake, keeping geometry as WKT."""
    try:
        query = '''
        SELECT 
            NAME,
            FIRE_DISCOVERY_DATETIME,
            CONTAINMENT_DATETIME,
            CONTROL_DATETIME,
            FIRE_OUT_DATETIME,
            ACRES,
            ST_ASWKT(PERIMETER_GEOGRAPHY) as PERIMETER_WKT
        FROM  
            ANALYTICS_ENGCA_PRD.ETHELO.RECENT_FIRE_PERIMETERS
        WHERE PERIMETER_GEOGRAPHY IS NOT NULL AND ST_NPOINTS(PERIMETER_GEOGRAPHY) > 2
        '''
        perimeter_df = session.sql(query).to_pandas()
        for col in ['FIRE_DISCOVERY_DATETIME', 'CONTAINMENT_DATETIME', 'CONTROL_DATETIME', 'FIRE_OUT_DATETIME']:
            if col in perimeter_df.columns:
                perimeter_df[col] = pd.to_datetime(perimeter_df[col], errors='coerce')
        return perimeter_df
    except Exception as e:
        st.error(f"Error querying Fire Data: {e}")
        return pd.DataFrame()

# load zip data
@st.cache_data
def load_zip_data_wkt():
    """Loads ZIP code geometry and impact data from Snowflake."""
    try:
        query = '''
        SELECT 
            ZIP_CODE,
            ST_ASWKT(ZIP_CODE_GEOGRAPHY) as WKT_STRING,
            FIRE_PERCENT_OF_ZIP,
            EVAC_ORDR_PCT_ZIP,
            EVAC_WRN_PCT_ZIP,
            DESTROYED_BUILDINGS,
            ANY_DAMAGE_BUILDINGS
        FROM 
            ANALYTICS_ENGCA_PRD.ETHELO.IMPACT_BY_ZIP
        '''
        zip_df = session.sql(query).to_pandas()
        
        # Convert ZIP_CODE to string for consistent joining
        zip_df['ZIP_CODE'] = zip_df['ZIP_CODE'].astype(str)
        
        return zip_df
    except Exception as e:
        st.error(f"Error querying ZIP Code Data: {e}")
        return pd.DataFrame()

# load voting summary data
@st.cache_data
def load_voting_summary():
    """Loads ZIP code geometry and impact data from Snowflake."""
    try:
        query = '''
        select TOPIC, OPTION, SUPPORT, NEGATIVE_VOTES, AVERAGE_WEIGHTING, CONFLICT, ABSTAIN_VOTES
        , IN_BEST_SCENARIO, APPROVAL, CONSENSUS, TOTAL_VOTES, POSITIVE_VOTES, NOT_IMPORTANT, SOMEWHAT_IMPORTANT
        , SLIGHTLY_SUPPORT, SLIGHTLY_OPPOSE, ESSENTIAL
        from ANALYTICS_ENGCA_PRD.ETHELO.VOTING_SUMMARY
        '''
        voting_summary_df = session.sql(query).to_pandas()
        
        return voting_summary_df
    except Exception as e:
        st.error(f"Error querying VOTING_SUMMARY Data: {e}")
        return pd.DataFrame()

@st.cache_data
def load_evacuation_zones():
    """Loads evacuation zone data from Snowflake with WKT geometry."""
    try:
        query = '''
        SELECT 
            ZONEID,
            INCIDENT_NAME,
            MOST_EXTREME_STATUS,
            ST_ASWKT(ZONE_GEOGRAPHY) as ZONE_WKT
        FROM 
            ANALYTICS_ENGCA_PRD.ETHELO.MAXIMUM_EXTENT_EVAC_ZONES
        WHERE ZONE_GEOGRAPHY IS NOT NULL
        '''
        evac_df = session.sql(query).to_pandas()
        return evac_df
    except Exception as e:
        st.error(f"Error querying Evacuation Zone Data: {e}")
        return pd.DataFrame()



# --- Helper Functions for Map ---
def format_datetime(dt):
    """Formats datetime object into 'Month Day, Year at HH:MM AM/PM' format."""
    if pd.notna(dt) and not pd.isna(dt):
        return dt.strftime('%b %d, %Y at %I:%M %p')
    else:
        return 'N/A'

def get_color_from_count(count, min_val, max_val, color_scale='blue', alpha=120):
    """Calculates RGBA color based on count relative to min/max."""
    if max_val <= min_val: # Handle zero range or single value
        normalized = 0.5
    else:
        clamped_count = max(min_val, min(count, max_val))
        normalized = (clamped_count - min_val) / (max_val - min_val)

    intensity = int(50 + normalized * 200) # Range 50-250

    # Simple sequential blue scale (light blue for low counts, dark blue for high)
    if color_scale == 'blue':
        return [0, 0, intensity, alpha]
    else:
        return [0, 0, intensity, alpha] # Default to blue


# Load both datasets
df = load_data()
comments_df = load_comments_data()
race_ethnicity_df = load_race_ethnicity_data() 


# Merge data
df = pd.merge(df, comments_df, on='PARTICIPANT_ID', how='left')
df['NUM_COMMENTS'] = df['NUM_COMMENTS'].fillna(0)
df['NUM_REPLIES'] = df['NUM_REPLIES'].fillna(0)
df['NUM_FLAGS'] = df['NUM_FLAGS'].fillna(0)
df['NUM_LIKES'] = df['NUM_LIKES'].fillna(0)

# Create sidebar with filters
st.sidebar.header("Filters")

# Get all unique values for each filter
fire_zone_options = ['All'] + sorted(df['FIRE_ZONE'].dropna().unique().tolist()) + ['No Response']
zip_options = ['All'] + sorted(df['ZIP'].dropna().unique().tolist()) + ['No Response']
housing_options = ['All'] + sorted(df['HOUSING_STATUS'].dropna().unique().tolist()) + ['No Response']
income_options = ['All'] + sorted(df['HOUSEHOLD_INCOME_PRETAX'].dropna().unique().tolist()) + ['No Response']
race_options = ['All'] + sorted(df['RACE_ETHNICITY'].dropna().unique().tolist()) + ['No Response']

# New filters
fire_impact_employment_options = ['All'] + sorted(df['FIRE_IMPACT_EMPLOYMENT'].dropna().unique().tolist()) + ['No Response']
city_options = ['All'] + sorted(df['CITY'].dropna().unique().tolist()) + ['No Response']

# Create the filters in the sidebar - CHANGED TO MULTISELECT WITH ALL VALUES SELECTED BY DEFAULT
selected_fire_zone = st.sidebar.multiselect("Fire Zone", fire_zone_options[1:], default=fire_zone_options[1:])
# selected_city = st.sidebar.multiselect("City", city_options[1:], default=city_options[1:])
selected_fire_impact_employment = st.sidebar.multiselect("Fire Impact on Employment", fire_impact_employment_options[1:], default=fire_impact_employment_options[1:])
selected_housing = st.sidebar.multiselect("Housing Status", housing_options[1:], default=housing_options[1:])
selected_income = st.sidebar.multiselect("Household Income", income_options[1:], default=income_options[1:])
selected_race = st.sidebar.multiselect("Race/Ethnicity", race_options[1:], default=race_options[1:])
selected_zip = st.sidebar.multiselect("ZIP Code", zip_options[1:], default=zip_options[1:])

# Apply filters to the dataframe
filtered_df = df.copy()

# UPDATED FILTER LOGIC FOR MULTISELECT WITH NULL HANDLING
if selected_fire_zone:
    filtered_df = apply_filter_with_nulls(filtered_df, 'FIRE_ZONE', selected_fire_zone)

# if selected_city:
#     filtered_df = apply_filter_with_nulls(filtered_df, 'CITY', selected_city)
if selected_fire_impact_employment:
    filtered_df = apply_filter_with_nulls(filtered_df, 'FIRE_IMPACT_EMPLOYMENT', selected_fire_impact_employment)
if selected_housing:
    filtered_df = apply_filter_with_nulls(filtered_df, 'HOUSING_STATUS', selected_housing)
if selected_income:
    filtered_df = apply_filter_with_nulls(filtered_df, 'HOUSEHOLD_INCOME_PRETAX', selected_income)
if selected_race:
    filtered_df = apply_filter_with_nulls(filtered_df, 'RACE_ETHNICITY', selected_race)
if selected_zip:
    filtered_df = apply_filter_with_nulls(filtered_df, 'ZIP', selected_zip)
    
# Create tabs
tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(["Participation", "LLM Analysis", "Source Data", "Participant Map", "Demographics", "Voting Summary"])



# Tab 1: Participation Metrics Tab
with tab1:
    # Filter data for joined users only from the filtered dataframe
    joined_df = filtered_df[filtered_df['STATUS'] == 'Joined']
    
    # Calculate the metrics based on filtered data
    total_users = len(filtered_df)
    joined_users = len(filtered_df[filtered_df['STATUS'] == 'Joined'])
    voting_complete = len(filtered_df[filtered_df['VOTING_COMPLETE'] == 100])
    survey_complete = len(filtered_df[filtered_df['SURVEY_COMPLETED'] == 100])
    started_survey_or_voting = len(filtered_df[filtered_df['COMPLETION'] > 0])
    total_comments = filtered_df['COMMENT_COUNT'].sum()
    users_w_comments = sum(filtered_df['COMMENT_COUNT'] > 0)


    # Calculate metrics for this tab
    total_invites = len(filtered_df)
    total_joined = len(filtered_df[filtered_df['STATUS'] == 'Joined'])
    total_started = len(filtered_df[filtered_df['COMPLETION'] > 0])
    total_complete = len(filtered_df[(filtered_df['VOTING_COMPLETE'] == 100) & (filtered_df['SURVEY_COMPLETED'] == 100)])
    
    total_comments = filtered_df['NUM_COMMENTS'].sum()
    participants_commented = len(filtered_df[filtered_df['NUM_COMMENTS'] > 0])
    total_likes = filtered_df['NUM_LIKES'].sum()
    total_flags = filtered_df['NUM_FLAGS'].sum()
    total_replies = filtered_df['NUM_REPLIES'].sum()
    
    # Calculate rates
    join_rate = round((total_joined / total_invites) * 100, 2) if total_invites > 0 else 0
    participation_rate = round((total_started / total_joined) * 100, 2) if total_joined > 0 else 0
    completion_rate = round((total_complete / total_started) * 100, 2) if total_started > 0 else 0
    
    # Calculate engagement metrics
    comments_per_participant = round(total_comments / participants_commented, 2) if participants_commented > 0 else 0
    
    # Calculate standard deviation of comments per participant
    comments_data = filtered_df[filtered_df['NUM_COMMENTS'] > 0]['NUM_COMMENTS']
    std_comments = round(comments_data.std(), 2) if len(comments_data) > 0 else 0
    
    # Positivity ratio
    positivity_ratio = round((total_likes - total_flags) / total_comments, 2) if total_comments > 0 else 0
    
    # SECTION 1: How much did we do? (quantity measures)
    st.subheader("How much did we do? (quantity measures)")
    
    # Participation metrics
    st.markdown("##### Participation")
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Invites to the platform", total_invites)
    with col2:
        st.metric("Participants joined", total_joined)
    with col3:
        st.metric("Participants started", total_started)
    with col4:
        st.metric("Participants complete", voting_complete, 
                 help="Number of users who completed 100% of the voting")
    
    # Engagement metrics
    st.markdown("##### Engagement")
    col1, col2, col3, col4, col5 = st.columns(5)
    
    with col1:
        st.metric("Number of comments", int(total_comments))
    with col2:
        st.metric("Participants commented", participants_commented)
    with col3:
        st.metric("Number of likes", int(total_likes))
    with col4:
        st.metric("Number of flagged comments", int(total_flags))
    with col5:
        st.metric("Number of replies", int(total_replies))
    
    # SECTION 2: How well did we do it? (quality measures)
    st.subheader("How well did we do it? (quality measures)")
    
    # Participation rates
    st.markdown("##### Participation")
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.metric("Join rate", f"{join_rate}%", 
                 help="Join rate (conversion from invite to participant) = participants joined / invites to the platform")
    with col2:
        st.metric("Participation rate", f"{participation_rate}%", 
                 help="Participation rate (conversion from joined to started) = participants started / participants joined")
    with col3:
        st.metric("Completion rate", f"{completion_rate}%", 
                 help="Completion rate (conversion of started to completed) = participants complete / participants started")
    
    # Engagement quality
    st.markdown("##### Engagement")
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.metric("Comments per participant", comments_per_participant, 
                 help="Comments per participant = number of comments / number of participants that have commented")
    with col2:
        st.metric("Std dev of comments per participant", std_comments, 
                 help="Standard deviation of the number of comments per participant")
    with col3:
        st.metric("Positivity ratio", positivity_ratio, 
                 help="Positivity ratio = (number of likes - number of flagged comments) / number of comments")

# Tab 2: Comment Analysis Tab
with tab2:
    st.subheader("LLM Comment Analysis by Topic")
    
    # Create sub-tabs for analysis and source comments
    llm_tab1, llm_tab2 = st.tabs(["Comment Analysis", "Source Comments"])
    
    with llm_tab1:
        # Add multi-select for topic selection
        topic_options = [
            "Financial & legal assistance", 
            "Climate & community resilience", 
            "Wildfire prevention prioritization & accountability", 
            "Emergency communication", 
            "Economic recovery & small business support", 
            "Debris removal & environmental recovery", 
            "Infrastructure & utilities restoration", 
            "Emergency planning & community safety", 
            "Emotional & mental health support", 
            "Housing & rebuilding", 
            "Prioritize recovery themes",
            "Main Recovery Perspective",
            "Main Recovery Priority"
        ]
        
        # Define LLM options
        llm_options = ['snowflake-llama-3.3-70b','snowflake-llama-3.1-405b', 'claude-3-5-sonnet']
        
        # Define a function to map the actual values to display names
        def format_llm_option(option):
            if option == "snowflake-llama-3.1-405b":
                return "Llama 3.1 - 405B"
            elif option == "claude-3-5-sonnet":
                return "Claude 3.5 Sonnet (Most capable & Costly)"
            elif option == "snowflake-llama-3.3-70b":
                return "Llama 3.3 - 70B (Fast & Low-Cost)"
            return option  # Fallback for any other options
        
        # Create columns for your dropdowns
        col1, col2, col3 = st.columns([2, 1, 1])  # Proportional widths
        
        with col1:
            # Topic multi-selector
            selected_topics = st.multiselect("Select Topic(s)", topic_options, default=[topic_options[0]])
            
        with col2:
            # LLM selector with custom width
            selected_llm = st.selectbox("Select LLM Model", llm_options, format_func=format_llm_option)
            
        with col3:
            # Cost display
            st.write("")  # Add some space for alignment with other elements
            # st.info("Select topics and model, then click Generate to see cost.")
            
            # Variable to store the last query usage data
            if 'last_query_tokens' not in st.session_state:
                st.session_state.last_query_tokens = 0
                st.session_state.last_query_cost = 0.0
        
        # Add toggle for using custom prompt - SIMPLIFIED WITH CONFIG FLAG
        if ENABLE_CUSTOM_PROMPT:
            use_custom_prompt = st.checkbox("Use custom prompt", value=False)
        else:
            use_custom_prompt = False
        
        # Default user prompt template (removed the topic reference)
        default_user_prompt = '''Perform an open-coding analysis on these comments and identify 3–6 emerging themes.

Your output should follow this general format for each theme:

#### [Theme number]. [Theme Label] 

*Description: [Theme description]*

*Representative quotes:*
    
    - [At least three representative, strictly verbatim quotes (use ellipses [...] to trim irrelevant parts). Choose quotes that are highly representative, clear, and distinctive.]'''
        
        # Custom prompt input (show only if use_custom_prompt is checked)
        custom_prompt = ""
        if use_custom_prompt:
            # Show default prompt for reference
            st.caption("Default prompt (for reference):")
            st.code(default_user_prompt, language="text")
            
            # Custom prompt text area
            custom_prompt = st.text_area(
                "Enter your custom prompt:", 
                height=300,
                help="Focus on your analysis instructions. Background information about the wildfires, data format, and topics is automatically included. You don't need to reference the topic or include {topic} placeholders."
            )
        
        # Get the list of participant IDs from the filtered dataframe
        # Focus on participants who have made comments
        commenting_participants = filtered_df[filtered_df['NUM_COMMENTS'] > 0]['PARTICIPANT_ID'].tolist()
        
        if not commenting_participants:
            st.warning("No participants with comments match your current filter criteria. Please adjust your filters to see comment analysis.")
        elif not selected_topics:
            st.warning("Please select at least one topic to analyze.")
        else:
            # Add button to generate analysis
            generate_button = st.button("Generate Comment Analysis")
            
            if generate_button:
                # Check if we have a valid custom prompt when the toggle is on
                if use_custom_prompt and not custom_prompt.strip():
                    st.error("Please enter a custom prompt or uncheck 'Use custom prompt'.")
                else:
                    # Fetch comment analysis based on the filtered participant IDs, selected topics, LLM, and prompt
                    with st.spinner(f"Generating comment analysis for all selected topics... This may take a moment."):
                        # Use custom prompt if toggled on, otherwise use default
                        prompt_to_use = custom_prompt if use_custom_prompt else None
                        comment_analysis = load_comment_analysis(commenting_participants, selected_topics, selected_llm, prompt_to_use)
                    
                    if comment_analysis.empty:
                        st.warning("No comment analysis data available for the current selection.")
                    else:
                        # Get the first (and only) row
                        row = comment_analysis.iloc[0]
                        
                        # Display analysis header
                        st.subheader(f"Analysis for: {row['TOPIC_LIST']}")
                        
                        # Parse the JSON response
                        import json
                        response_data = json.loads(row['DESC_RAW'])
                        
                        # Extract the messages content
                        analysis_text = response_data['choices'][0]['messages']
                        
                        # Calculate and store token usage and cost
                        if 'usage' in response_data:
                            total_tokens = response_data['usage'].get('total_tokens', 0)
                            st.session_state.last_query_tokens = total_tokens
                            
                            # Calculate cost in dollars
                            cost_per_million = MODEL_COSTS.get(selected_llm, 0)
                            query_cost = (total_tokens / 1000000) * cost_per_million
                            st.session_state.last_query_cost = query_cost
                            
                            # Update the cost display in the third column
                            with col3:
                                st.info(f"The last query used {total_tokens:,} tokens and cost ${query_cost:.4f}")
                        
                        # Display only the messages content
                        st.markdown(analysis_text)
    
    # Source Comments Tab
    with llm_tab2:
        st.subheader("Source Comments")
        
        # Only load if we have participants and topics selected
        if not commenting_participants:
            st.warning("No participants with comments match your current filter criteria. Please adjust your filters to see source comments.")
        elif not selected_topics:
            st.warning("Please select at least one topic to view source comments.")
        else:
            # Add button to load source comments
            load_comments_button = st.button("Load Source Comments")
            
            if load_comments_button:
                with st.spinner(f"Loading source comments for {len(selected_topics)} topic(s)..."):
                    comment_sources = load_source_comments(commenting_participants, selected_topics)
                    
                discussion_comments = comment_sources['discussion_comments']
                participant_perspectives = comment_sources['participant_perspectives']
                
                if discussion_comments.empty and participant_perspectives.empty:
                    st.warning("No comments found for the selected topics and participants.")
                else:
                    # Display comment counts
                    discussion_count = len(discussion_comments)
                    perspectives_count = len(participant_perspectives)
                    total_count = discussion_count + perspectives_count
                    
                    st.info(f"Found {total_count} total comments ({discussion_count} discussion comments and {perspectives_count} participant perspectives)")
                    
                    # Create tabs for the different comment sources
                    comment_source_tab1, comment_source_tab2 = st.tabs(["Discussion Comments", "Participant Perspectives"])
                    
                    # Display Discussion Comments in first tab
                    with comment_source_tab1:
                        if discussion_comments.empty:
                            st.warning("No discussion comments found for the selected topics and participants.")
                        else:
                            # Add filter for specific topics if multiple are selected
                            if len(selected_topics) > 1 and 'TARGET' in discussion_comments.columns:
                                topic_filter = st.multiselect(
                                    "Filter by topic", 
                                    discussion_comments['TARGET'].unique().tolist(),
                                    default=discussion_comments['TARGET'].unique().tolist(),
                                    key="discussion_topic_filter"
                                )
                                filtered_discussion = discussion_comments[discussion_comments['TARGET'].isin(topic_filter)]
                            else:
                                filtered_discussion = discussion_comments
                            
                            # Display the comments table
                            st.dataframe(
                                filtered_discussion,
                                use_container_width=True
                            )
                    
                    # Display Participant Perspectives in second tab
                    with comment_source_tab2:
                        if participant_perspectives.empty:
                            st.warning("No participant perspectives found for the selected topics and participants.")
                        else:
                            # Add filter for specific topics if multiple are selected
                            if len(selected_topics) > 1 and 'TARGET' in participant_perspectives.columns:
                                topic_filter = st.multiselect(
                                    "Filter by topic", 
                                    participant_perspectives['TARGET'].unique().tolist(),
                                    default=participant_perspectives['TARGET'].unique().tolist(),
                                    key="perspectives_topic_filter"
                                )
                                filtered_perspectives = participant_perspectives[participant_perspectives['TARGET'].isin(topic_filter)]
                            else:
                                filtered_perspectives = participant_perspectives
                            
                            # Display the comments table
                            st.dataframe(
                                filtered_perspectives,
                                use_container_width=True
                            )





# Tab 3: Source Data
with tab3:
    st.subheader("Filtered Source Data")
    
    # Show number of records
    st.write(f"Showing {len(filtered_df)} records based on current filters")
    
    # Get all column names
    all_columns = filtered_df.columns.tolist()
    
    # Let user select columns to display
    col1, col2 = st.columns([3, 1])
    
    with col1:
        selected_columns = st.multiselect(
            "Select columns to display",
            all_columns,
            default=["PARTICIPANT_ID", "FIRE_ZONE", "ZIP", "CITY"]
        )
    
    with col2:
        st.write("")  # Add some space
        st.write("")  # Add some space
        # Number of rows to display
        num_rows = st.slider("Rows to display", 5, 100, 20)
    
    # Display the filtered dataframe with selected columns
    if selected_columns:
        st.dataframe(filtered_df[selected_columns].head(num_rows), use_container_width=True)
    else:
        st.warning("Please select at least one column to display")
    
    # Create expander for download options
    with st.expander("Download Options"):
        col1, col2 = st.columns(2)
        
        with col1:
            # Create a download button for all data
            csv_all = filtered_df.to_csv(index=False)
            st.download_button(
                label="Download All Filtered Data",
                data=csv_all,
                file_name="fire_recovery_all_filtered_data.csv",
                mime="text/csv",
                use_container_width=True
            )
        
        with col2:
            # Create a download button for selected columns only
            if selected_columns:
                csv_selected = filtered_df[selected_columns].to_csv(index=False)
                st.download_button(
                    label="Download Selected Columns Only",
                    data=csv_selected,
                    file_name="fire_recovery_selected_columns.csv",
                    mime="text/csv",
                    use_container_width=True
                )
            else:
                st.write("Select columns to enable download")

# Tab 4:  Fire Map 
with tab4:
    st.subheader("Fire Perimeters & ZIP Code Participant Map")
    
    # --- Load Map Data ---
    with st.spinner("Loading map data from Snowflake..."):
        fire_perimeters_df = load_fire_perimeters()
        zip_df = load_zip_data_wkt()
        evacuation_zones_df = load_evacuation_zones()    

    col1, col2, col3 = st.columns(3)
    
    with col1:
        show_evac_zones = st.checkbox("Evacuation Zones", value=True, 
                                     help="Toggle evacuation zone visibility")
    with col2:
        show_fire_perimeters = st.checkbox("Fire Perimeters", value=True,
                                          help="Toggle fire perimeter visibility")
    with col3:
        show_zip_codes = st.checkbox("ZIP Code Participants", value=True,
                                    help="Toggle ZIP code participant data visibility")
        
    # --- Process Data: Create GeoJSON Features with Pre-built Tooltip HTML ---
    fire_geojson_features = []
    zip_geojson_features = []
    
    # Process Fire Data
    if not fire_perimeters_df.empty:
        for idx, row in fire_perimeters_df.iterrows():
            try:
                wkt_string = row.get('PERIMETER_WKT')
                if pd.isna(wkt_string) or not isinstance(wkt_string, str): continue
                geometry = wkt.loads(wkt_string)
                geojson_geometry = mapping(geometry)
    
                # Pre-build HTML for fire tooltips
                name = row.get('NAME', 'N/A')
                acres = float(row['ACRES']) if pd.notna(row['ACRES']) else 0.0
                d_dt = format_datetime(row.get('FIRE_DISCOVERY_DATETIME'))
                c_dt = format_datetime(row.get('CONTAINMENT_DATETIME'))
                ctrl_dt = format_datetime(row.get('CONTROL_DATETIME'))
                o_dt = format_datetime(row.get('FIRE_OUT_DATETIME'))
    
                tooltip_html = f"""
                    <div style='font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 5px; padding-bottom: 2px;'>
                        {name}
                    </div>
                    Acres: {acres:,.1f}<br>
                    <div style='margin-top: 5px; padding-top: 5px; border-top: 1px solid #999;'>
                     <i style='font-size: 0.9em;'>
                        Discovered: {d_dt}<br>
                        Contained: {c_dt}<br>
                        Controlled: {ctrl_dt}<br>
                        Out: {o_dt}
                     </i>
                    </div>
                """
    
                feature = {
                    "type": "Feature",
                    "geometry": geojson_geometry,
                    "properties": {
                        "tooltip_html": tooltip_html
                    }
                }
                fire_geojson_features.append(feature)
            except Exception as e:
                st.error(f"Error Processing Fire Data: {e}")
        fire_geojson_data = {"type": "FeatureCollection", "features": fire_geojson_features}
    else:
        fire_geojson_data = None

    
    # Process Evacuation Zone Data
    evac_geojson_features = []
    if not evacuation_zones_df.empty:
        for idx, row in evacuation_zones_df.iterrows():
            try:
                wkt_string = row.get('ZONE_WKT')
                if pd.isna(wkt_string) or not isinstance(wkt_string, str): continue
                geometry = wkt.loads(wkt_string)
                geojson_geometry = mapping(geometry)
    
                # Get properties for tooltip
                zone_id = row.get('ZONEID', 'Unknown')
                incident = row.get('INCIDENT_NAME', 'N/A')
                status = row.get('MOST_EXTREME_STATUS', 'N/A')
                
                # Different colors based on evacuation status
                if status == 'Evacuation Order':
                    # Light orange for Evacuation Order
                    fill_color = [255, 173, 51, 60]  # Light orange with transparency
                    line_color = [255, 140, 0, 120]  # Darker orange outline
                elif status == 'Evacuation Warning':
                    # Yellow for Evacuation Warning
                    fill_color = [255, 255, 0, 20]  # Yellow with transparency
                    line_color = [255, 255, 0, 80]  # Darker yellow outline
                else:
                    # Default for any other status
                    fill_color = [255, 255, 0, 60]  # Yellow with transparency
                    line_color = [255, 255, 0, 120]  # Darker yellow outline
    
                # Pre-build HTML for evacuation zone tooltips
                tooltip_html = f"""
                    <div style='font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 5px; padding-bottom: 2px;'>
                        Evacuation Zone: {zone_id}
                    </div>
                    <div>Incident: {incident}</div>
                    <div>Status: <span style="color: {'#ff8c00' if status == 'Evacuation Order' else '#ffa500' if status == 'Evacuation Warning' else '#ffff00'};
                                      font-weight: bold;">
                        {status}</span>
                    </div>
                """
    
                feature = {
                    "type": "Feature",
                    "geometry": geojson_geometry,
                    "properties": {
                        "tooltip_html": tooltip_html,
                        "fill_color": fill_color,
                        "line_color": line_color,
                        "status": status  # Add status to properties for potential filtering
                    }
                }
                evac_geojson_features.append(feature)
            except Exception as e:
                st.error(f"Error Evac Zone Data: {e}")   
                
        evac_geojson_data = {"type": "FeatureCollection", "features": evac_geojson_features}
    else:
        evac_geojson_data = None


    
    # Process ZIP Data
    if not zip_df.empty:
        
        # Get zip code counts from filtered data
        if 'joined_df' in locals() and not joined_df.empty:
            # Convert zip values to string for consistent joining
            zip_counts = joined_df['ZIP'].astype(str).value_counts().reset_index()
            zip_counts.columns = ['ZIP_CODE', 'NUM_PARTICIPANTS']
            
            # Merge the counts with the zip geographical data
            zip_df = pd.merge(zip_df, zip_counts, on='ZIP_CODE', how='inner')
            zip_df['NUM_PARTICIPANTS'] = zip_df['NUM_PARTICIPANTS'].fillna(0).astype(int)
            zip_df['FIRE_PERCENT_OF_ZIP'] = zip_df['FIRE_PERCENT_OF_ZIP'].fillna(0).astype(float)
            zip_df['EVAC_ORDR_PCT_ZIP'] = zip_df['EVAC_ORDR_PCT_ZIP'].fillna(0).astype(float)
            zip_df['EVAC_WRN_PCT_ZIP'] = zip_df['EVAC_WRN_PCT_ZIP'].fillna(0).astype(float)
            zip_df['DESTROYED_BUILDINGS'] = zip_df['DESTROYED_BUILDINGS'].fillna(0).astype(int)
            zip_df['ANY_DAMAGE_BUILDINGS'] = zip_df['ANY_DAMAGE_BUILDINGS'].fillna(0).astype(int)
        else:
            zip_df['NUM_PARTICIPANTS'] = 0
        
        min_participants = zip_df['NUM_PARTICIPANTS'].min()
        max_participants = zip_df['NUM_PARTICIPANTS'].max()
        
        for idx, row in zip_df.iterrows():
            try:
                wkt_string = row.get('WKT_STRING')
                if pd.isna(wkt_string) or not isinstance(wkt_string, str): continue
                geometry = wkt.loads(wkt_string)
                geojson_geometry = mapping(geometry)
        
                zip_code = row.get('ZIP_CODE', 'N/A')
                participant_count = int(row['NUM_PARTICIPANTS'])
                fill_color = get_color_from_count(participant_count, min_participants, max_participants, alpha=80)
        
                # Updated tooltip with new variables
                tooltip_html = f"""
                    <div style='font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 5px; padding-bottom: 2px;'>
                        ZIP Code: {zip_code}
                    </div>
                    <div style='margin-bottom: 5px;'>
                        Participants: {participant_count:,}
                    </div>
                    <div style='margin-top: 5px; border-top: 1px solid #ccc; padding-top: 5px;'>
                        <div>% Burned: {row.get('FIRE_PERCENT_OF_ZIP', 0):.2f}%</div>
                        <div>% Evac Order: {row.get('EVAC_ORDR_PCT_ZIP', 0):.1f}%</div>
                        <div>% Evac Warning: {row.get('EVAC_WRN_PCT_ZIP', 0):.1f}%</div>
                        <div>Buildings Destroyed: {int(row.get('DESTROYED_BUILDINGS', 0)):,}</div>
                        <div>Buildings Damaged: {int(row.get('ANY_DAMAGE_BUILDINGS', 0)):,}</div>
                    </div>
                """
        
                feature = {
                    "type": "Feature",
                    "geometry": geojson_geometry,
                    "properties": {
                        "tooltip_html": tooltip_html, 
                        "fill_color": fill_color
                    }
                }
                zip_geojson_features.append(feature)
            except Exception as e:
                st.error(f"Error Zip Geography Data: {e}")   

        
        zip_geojson_data = {"type": "FeatureCollection", "features": zip_geojson_features}
    else:
        zip_geojson_data = None



    
    # --- Display Map ---
    if not fire_geojson_data and not zip_geojson_data:
        st.error("No data available to display on the map.")
    else:
        # --- Define Layers ---
        layers = []
        
        # Evacuation Zone Layer (drawn first, at the bottom)
        if evac_geojson_data and evac_geojson_features and show_evac_zones:  # Add the condition here
            evac_layer = pdk.Layer(
                "GeoJsonLayer",
                data=evac_geojson_data,
                id='evac-layer',
                opacity=0.7,
                stroked=True,
                filled=True,
                get_fill_color='properties.fill_color',
                get_line_color='properties.line_color',
                get_line_width=1,
                line_width_min_pixels=1,
                pickable=True,
                auto_highlight=True,
                highlight_color=[255, 255, 255, 120]  # White highlight
            )
            layers.append(evac_layer)
        
        # Fire Perimeter Layer
        if fire_geojson_data and fire_geojson_features and show_fire_perimeters:  # Add the condition here
            fire_layer = pdk.Layer(
                "GeoJsonLayer",
                data=fire_geojson_data,
                id='fire-layer',
                opacity=0.6,
                stroked=True,
                filled=True,
                get_fill_color=[230, 50, 0, 100],
                get_line_color=[255, 0, 0, 200],
                get_line_width=1,
                line_width_min_pixels=1,
                pickable=True,
                auto_highlight=True,
                highlight_color=[255, 165, 0, 180]
            )
            layers.append(fire_layer)
        
        # ZIP Code Layer
        if zip_geojson_data and zip_geojson_features and show_zip_codes:  # Add the condition here
            zip_layer = pdk.Layer(
                "GeoJsonLayer",
                data=zip_geojson_data,
                id='zip-layer',
                opacity=0.4,
                stroked=True,
                filled=True,
                get_fill_color='properties.fill_color',
                get_line_color=[1, 19, 64, 150],
                get_line_width=3,
                line_width_min_pixels=1,
                pickable=True,
                auto_highlight=True,
                highlight_color=[0, 255, 255, 150]
            )
            layers.append(zip_layer)
    
        if not layers:
            st.error("Could not create any map layers.")
        else:
            # --- Define ViewState ---
            view_state = pdk.ViewState(
                latitude=34.0522,
                longitude=-118.2437,
                zoom=9,
                pitch=0,
                bearing=0
            )
    
            # --- Define Tooltip ---
            tooltip = {
                "html": "{tooltip_html}",
                "style": {
                    "backgroundColor": "rgba(0, 0, 50, 0.8)", 
                    "color": "white",
                    "padding": "10px", 
                    "borderRadius": "5px", 
                    "borderColor": "white",
                    "borderWidth": "1px", 
                    "borderStyle": "solid", 
                    "maxWidth": "300px",
                    "fontSize": "0.9em"
                }
            }
    
            # --- Create and Render Deck ---
            deck = pdk.Deck(
                layers=layers,
                initial_view_state=view_state,
                map_style="mapbox://styles/mapbox/light-v11",
                tooltip=tooltip
            )
    
            st.pydeck_chart(deck, use_container_width=True)
    
            # Optional Data Expanders
            col1, col2 = st.columns(2)
            
            with col1:
                with st.expander("View Fire Perimeter Data"):
                    display_fire_df = fire_perimeters_df.drop(columns=['PERIMETER_WKT'], errors='ignore')
                    # Format dates for display
                    for col in ['FIRE_DISCOVERY_DATETIME', 'CONTAINMENT_DATETIME', 'CONTROL_DATETIME', 'FIRE_OUT_DATETIME']:
                        if col in display_fire_df.columns:
                            display_fire_df[col] = display_fire_df[col].apply(lambda x: x.strftime('%Y-%m-%d %H:%M') if pd.notna(x) else 'N/A')
                    st.dataframe(display_fire_df, use_container_width=True, hide_index=True)
            
            with col2:
                with st.expander("View ZIP Code Participant Data"):
                    display_zip_df = zip_df.drop(columns=['WKT_STRING'], errors='ignore')
                    st.dataframe(display_zip_df, use_container_width=True, hide_index=True)
            
            # Add map usage instructions
            st.info("""
            **Map Notes:**
            - There appears to be an issue with the '% Burned' by zip code calculation. We are working to resolve it. 
            - The fire perimeters reflect fires >40 acres that were discovered in CA between November 1, 2024 and March 12, 2025
            """)


# Tab 5: Demographics Overview (Original Dashboard)
with tab5:

    

    

    
    # Filter data for joined users only from the filtered dataframe
    joined_df = filtered_df[filtered_df['STATUS'] == 'Joined']
    
    # Create demographic breakdowns
    st.subheader("Demographic Information for Joined Users")
    
    # Create four columns for the different demographic categories
    col1, col2, col3, col4 = st.columns(4)
    
    # ZIP Code breakdown
    with col1:
        st.markdown("##### ZIP Codes")
        # Count records by ZIP
        zip_counts = joined_df[['ZIP','FIRE_ZONE']].value_counts().reset_index()
        zip_counts.columns = ['ZIP Code', 'FIRE', 'Count']
        st.dataframe(zip_counts, use_container_width=False, hide_index=True)
    
    # Housing Status breakdown
    with col2:
        st.markdown("##### Housing Status")
        # Count records by Housing Status
        housing_counts = joined_df['HOUSING_STATUS'].value_counts().reset_index()
        housing_counts.columns = ['Housing Status', 'Count']
        st.dataframe(housing_counts, use_container_width=False, hide_index=True)
    
    # Household Income breakdown
    with col3:
        st.markdown("##### Household Income")
        # Count records by Income
        income_counts = joined_df['HOUSEHOLD_INCOME_PRETAX'].value_counts().reset_index()
        income_counts.columns = ['Household Income', 'Count']
        st.dataframe(income_counts, use_container_width=False, hide_index=True)
    
    # Race/Ethnicity breakdown
    with col4:
        st.markdown("##### Race/Ethnicity")
        # Count records by Race/Ethnicity
        race_counts = joined_df['RACE_ETHNICITY'].value_counts().reset_index()
        race_counts.columns = ['Race/Ethnicity', 'Count']
        st.dataframe(race_counts, use_container_width=False, hide_index=True)

    st.subheader(" ")
    # Add Race/Ethnicity Alone or Combo table at the bottom
    st.subheader("Race/Ethnicity (Alone or in Combination)")
    # Format the dataframe for display
    display_race_df = race_ethnicity_df.copy()
    
    # Rename columns to proper case
    display_race_df.columns = [
        'Race/Ethnicity',
        'Number of Participants',
        'Percent of All Participants',
        'Percent of RE Respondents'
    ]
    
    # Format percentage columns
    display_race_df['Percent of All Participants'] = display_race_df['Percent of All Participants'].apply(lambda x: f"{x:.1f}%")
    display_race_df['Percent of RE Respondents'] = display_race_df['Percent of RE Respondents'].apply(lambda x: f"{x:.1f}%")
    
    # Display the formatted dataframe
    st.dataframe(display_race_df, use_container_width=True, hide_index=True)


# Tab 3: Source Data
with tab6:
    st.subheader("Voting Summary")
    voting_summary_df = load_voting_summary()
    # Show number of records
    
    # Get all column names
    all_columns = voting_summary_df.columns.tolist()
    
    # Let user select columns to display
    col1, col2 = st.columns([3, 1])
    
    with col1:
        selected_columns = st.multiselect(
            "Select columns to display",
            all_columns,
            default=["OPTION", "TOTAL_VOTES", "SUPPORT", "CONFLICT", "APPROVAL", "CONSENSUS"]
        )
    
    with col2:
        st.write("")  # Add some space
        # st.write("")  # Add some space
        # # Number of rows to display
        # num_rows = st.slider("Rows to display", 5, 100, 20)
    
    # Display the filtered dataframe with selected columns
    if selected_columns:
        st.dataframe(voting_summary_df[selected_columns], use_container_width=True)
    else:
        st.warning("Please select at least one column to display")
    
    # Create expander for download options
    with st.expander("Download Options"):
        col1, col2 = st.columns(2)
        
        with col1:
            # Create a download button for all data
            csv_all = voting_summary_df.to_csv(index=False)
            st.download_button(
                label="Download All Voting Sumary Data",
                data=csv_all,
                file_name="voting_summary.csv",
                mime="text/csv",
                use_container_width=True
            )
        
        with col2:
            # Create a download button for selected columns only
            if selected_columns:
                csv_selected = voting_summary_df[selected_columns].to_csv(index=False)
                st.download_button(
                    label="Download Selected Columns Only",
                    data=csv_selected,
                    file_name="voting_summary_selected_columns.csv",
                    mime="text/csv",
                    use_container_width=True
                )
            else:
                st.write("Select columns to enable download")