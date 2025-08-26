# Import python packages
import streamlit as st
from snowflake.snowpark.context import get_active_session
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
import numpy as np
import json
import os

#change environment variables to get bertopic to work in this environment
os.environ["NUMBA_CACHE_DIR"] = "/tmp"
os.environ["TRANSFORMERS_CACHE"] = "/tmp"
os.environ["TRANSFORMERS_CACHE"] = "/tmp"


# Configuration settings
ENABLE_CUSTOM_PROMPT = True  # Set to True to enable custom prompt option


COST_PER_SNOWFLAKE_CREDIT = 3.16

# Define model costs (credits per 1 million tokens)
MODEL_CREDIT_COSTS = {
    'claude-4-sonnet': 2.55,
    # 'openai-gpt-oss-120b': 0.11,
    # 'openai-gpt-5-chat': 1.60
    'llama4-maverick': 0.25,
    'snowflake-llama-3.1-405b': 0.96
}

# Calculate model costs in dollars per 1 million tokens
MODEL_COSTS = {
    model: credits * COST_PER_SNOWFLAKE_CREDIT
    for model, credits in MODEL_CREDIT_COSTS.items()
}

# Set page configuration
st.set_page_config(page_title="Engaged CA - E3 Comments Analysis", layout="wide")

# Get Snowflake session
session = get_active_session()

# Page title
st.header("Engaged CA - E3 Comments Analysis")

# Add introductory text
st.markdown("""
This dashboard analyzes responses from California state employees participating in the **E3 (Efficiency, Engagement, and Effectiveness)** platform.
Use this tool to:

- 🤖 **Generate AI-powered thematic analysis** of main ideas using advanced language models
- 📋 **Browse and export participant data** for further analysis
- 💡 **Identify emerging themes** and patterns in employee feedback

**Quick Start:** Navigate to the "LLM Comment Analysis" tab to generate insights, or go to "Data Export" to download the raw data.
""")

# ⬇️ Hide the delta arrow globally
st.markdown(
    """
    <style>
    /* st.metric delta arrow */
    [data-testid="stMetricDelta"] svg {display:none !important;}
    </style>
    """,
    unsafe_allow_html=True
)

# Load the participant responses data
@st.cache_data
def load_participant_responses_data():
    """Load E3 participant responses data from the database"""
    query = '''
    SELECT
        PARTICIPANT_ID,
        POINT_OF_PRIDE,
        IDEA_DEPT,
        POS_TYPE,
        CA_TENURE,
        MAIN_IDEA,
        WHATS_WORKING,
        OTHER_IDEAS,
        LAST_SURVEY_RESPONSE_DATE,
        LAST_COMMENT_DATE,
        _FILE_UPLOAD_DATE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_PARTICIPANT_RESPONSES
    ORDER BY LAST_COMMENT_DATE DESC
    '''

    df = session.sql(query).to_pandas()

    # Convert date columns to datetime
    date_columns = ['LAST_SURVEY_RESPONSE_DATE', 'LAST_COMMENT_DATE', '_FILE_UPLOAD_DATE']
    for col in date_columns:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')

    return df

# Load participant summary data
@st.cache_data
def load_participant_summary():
    """Load participant summary for E3 responses"""
    query = '''
    SELECT
        PARTICIPANT_ID,
        CASE WHEN MAIN_IDEA IS NOT NULL THEN 1 ELSE 0 END as has_main_idea,
        CASE WHEN WHATS_WORKING IS NOT NULL THEN 1 ELSE 0 END as has_whats_working,
        CASE WHEN OTHER_IDEAS IS NOT NULL THEN 1 ELSE 0 END as has_other_ideas,
        LAST_SURVEY_RESPONSE_DATE,
        LAST_COMMENT_DATE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_PARTICIPANT_RESPONSES
    ORDER BY LAST_COMMENT_DATE DESC NULLS LAST
    '''

    df = session.sql(query).to_pandas()

    # Convert dates to datetime
    for date_col in ['LAST_SURVEY_RESPONSE_DATE', 'LAST_COMMENT_DATE']:
        if date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], errors='coerce')

    return df

# Load LLM analysis for main ideas
@st.cache_data
def load_main_ideas_analysis(participant_ids, selected_llm, custom_prompt=None):
    """Load analysis of main ideas using LLM"""
    # Convert the list of participant IDs to a SQL-friendly string format
    if not participant_ids:
        participant_ids_str = "''"  # Empty string for SQL query if no participants
    else:
        participant_ids_str = "'" + "','".join(map(str, participant_ids)) + "'"

    # System prompt that provides background context and output format
    system_prompt = '''You are analyzing ideas from participants in an E3 (Efficiency, Engagement, and Effectiveness) civic engagement platform. These are ideas for improving government services and operations from California state employees.

Each idea includes the department/agency it applies to. The ideas are semi-colon separated.

Always format your response in Markdown. Use headers, bullet points, and other markdown formatting to make your analysis clear and readable.
IMPORTANT: your response should be no more than 3000 words.'''

    # Default user prompt template
    default_user_prompt = '''Perform an open-coding analysis on these main ideas and identify 3–6 emerging themes.

Your output should follow this general format for each theme:

#### [Theme number]. [Theme Label]

*Description: [Theme description]*

*Representative quotes:*
    - [At least three representative, strictly verbatim quotes from the ideas (use ellipses [...] to trim irrelevant parts). Choose quotes that are highly representative, clear, and distinctive.]'''

    # Use custom prompt if provided, otherwise use default
    user_prompt_template = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else default_user_prompt

    # Create the SQL query for main ideas
    query = f'''
    with main_ideas as (
        select
            PARTICIPANT_ID,
            MAIN_IDEA,
            IDEA_DEPT
        from ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_PARTICIPANT_RESPONSES
        where PARTICIPANT_ID in ({participant_ids_str})
        and MAIN_IDEA IS NOT NULL
        and TRIM(MAIN_IDEA) != ''
    ),
    ideas_agg as (
        select
            'Main Ideas Analysis' as topics,
            count(*) as n,
            LISTAGG(COALESCE(IDEA_DEPT, 'Unspecified') || ': ' || MAIN_IDEA, '; ') as target_ideas
        from main_ideas
    )
    select
        a.topics,
        a.n,
        len(a.target_ideas) as n_char,
        SNOWFLAKE.CORTEX.COMPLETE(
            '{selected_llm}',
            ARRAY_CONSTRUCT(
                OBJECT_CONSTRUCT('role', 'system', 'content', '{system_prompt}'),
                OBJECT_CONSTRUCT('role', 'user', 'content', CONCAT('{user_prompt_template}', '\\n\\nIdeas (Department: Idea):\\n', a.target_ideas))
            ),
            OBJECT_CONSTRUCT('temperature', 0)
        ) as desc_raw
    from ideas_agg a
    '''

    # Execute the query
    try:
        analysis_df = session.sql(query).to_pandas()
        return analysis_df
    except Exception as e:
        st.error(f"Error executing main ideas analysis query: {e}")
        return pd.DataFrame(columns=['TOPICS', 'N', 'N_CHAR', 'DESC_RAW'])


# Load the data
try:
    participant_responses_df = load_participant_responses_data()
    participant_summary_df = load_participant_summary()

    if participant_responses_df.empty:
        st.warning("No participant responses data available.")
        st.stop()

except Exception as e:
    st.error(f"Error loading data: {e}")
    st.stop()

# Calculate summary statistics
total_participants = len(participant_responses_df)
participants_with_ideas = len(participant_responses_df[
    participant_responses_df['MAIN_IDEA'].notna() &
    (participant_responses_df['MAIN_IDEA'].str.strip() != '')
])
participants_with_working_examples = len(participant_responses_df[
    participant_responses_df['WHATS_WORKING'].notna() &
    (participant_responses_df['WHATS_WORKING'].str.strip() != '')
])
participants_with_other_ideas = len(participant_responses_df[
    participant_responses_df['OTHER_IDEAS'].notna() &
    (participant_responses_df['OTHER_IDEAS'].str.strip() != '')
])

# Date range
if participant_responses_df['LAST_COMMENT_DATE'].notna().any():
    earliest_date = participant_responses_df['LAST_COMMENT_DATE'].min()
    latest_date = participant_responses_df['LAST_COMMENT_DATE'].max()
else:
    earliest_date = None
    latest_date = None

# Get most recent file upload date
if participant_responses_df['_FILE_UPLOAD_DATE'].notna().any():
    most_recent_upload = participant_responses_df['_FILE_UPLOAD_DATE'].max()
else:
    most_recent_upload = None

# Display header metrics
col1, col2, col3, col4, col5 = st.columns(5)

with col1:
    st.metric("Total Participants", total_participants, delta_color="off")

with col2:
    st.metric('''"Share Your Idea" Responses''', participants_with_ideas, delta_color="off")

with col3:
    st.metric('''"What's Working" Responses''', participants_with_working_examples, delta_color="off")

with col4:
    st.metric('''"Anything Else?" Responses''', participants_with_other_ideas, delta_color="off")

with col5:
    departments = participant_responses_df['IDEA_DEPT'].dropna().nunique()
    st.metric("Unique Departments", departments, delta_color="off")

# Display date range if available
if earliest_date and latest_date:
    date_info = f"Comments from {earliest_date.strftime('%B %d, %Y')} to {latest_date.strftime('%B %d, %Y')}"
    if most_recent_upload:
        date_info += f" | Current as of {most_recent_upload.strftime('%B %d, %Y')}"
    st.caption(date_info)

st.divider()

# No filters applied - use all data
filtered_df = participant_responses_df.copy()

# Create tabs
tab1, tab2, tab3 = st.tabs([
    "LLM Comment Analysis",
    "Data Export",
    "Topic Modeling"
])

# Tab 1: LLM Comment Analysis
with tab1:
    st.subheader("LLM Analysis of Main Ideas")

    st.markdown("""
    Select a model and click "Generate Analysis" to identify themes in the top-level "Share Your Idea" responses (with department). Other text fields and threaded replies aren't included yet.
    """)

    # Create sub-tabs for analysis and source data
    llm_tab1, llm_tab2 = st.tabs(["Idea Analysis", "Source Data"])

    with llm_tab1:
        st.markdown("""
        **Default Analysis:** The standard prompt performs open-coding analysis to identify 3-6 emerging themes with descriptions and representative quotes.

        **Custom Analysis:** Enable "Use custom prompt" below to create your own analysis approach (e.g., focus on specific topics, different analytical frameworks, sentiment analysis, etc.).
        """)

        # Filter to only participants with main ideas
        participants_with_main_ideas = filtered_df[filtered_df['MAIN_IDEA'].notna() & (filtered_df['MAIN_IDEA'].str.strip() != '')]

        if participants_with_main_ideas.empty:
            st.warning("No participants with main ideas found.")
        else:
            # Define LLM options
            llm_options = ['llama4-maverick', 'snowflake-llama-3.1-405b', 'claude-4-sonnet']

            # Define a function to map the actual values to display names
            def format_llm_option(option):
                if option == "llama4-maverick":
                    return "Llama 4 Maverick (Fast & Low-Cost)"
                elif option == "snowflake-llama-3.1-405b":
                    return "Snowflake Llama 3.1 - 405B"
                elif option == "claude-4-sonnet":
                    return "Claude 4 Sonnet (Most capable & Costly)"
                return option  # Fallback for any other options

            # Create columns for dropdowns and tips
            col1, col2, col3 = st.columns([1, 1, 1])  # Adjusted proportions

            with col1:
                # Add toggle for using custom prompt
                if ENABLE_CUSTOM_PROMPT:
                    use_custom_prompt = st.checkbox("Use custom prompt", value=False,
                        help="Enable this to write your own analysis instructions instead of using the default thematic analysis")
                else:
                    use_custom_prompt = False
                st.info(f"Analyzing {len(participants_with_main_ideas)} main ideas")
                # Cost display area
                st.write("")  # Add some space for alignment with other elements
                if 'last_query_tokens' not in st.session_state:
                    st.session_state.last_query_tokens = 0
                    st.session_state.last_query_cost = 0.0
            with col2:
                # LLM selector
                selected_llm = st.selectbox("Select LLM Model", llm_options, format_func=format_llm_option)
            with col3:
                # Model selection tips
                st.markdown("""
                **💡 Model Tips:** Choose from different models based on your needs for speed, cost, and analytical depth.
                - **Llama 4 Maverick**: Fast & low-cost
                - **Snowflake Llama 3**: Balanced option
                - **Claude 4 Sonnet**: Most sophisticated
                """)



            # Default user prompt template
            default_user_prompt = '''Perform an open-coding analysis on these comments and identify 3–6 emerging themes.

Your output should follow this general format for each theme:

#### [Theme number]. [Theme Label]

*Description: [Theme description]*

*Representative quotes:*
    - [At least three representative, strictly verbatim quotes (use ellipses [...] to trim irrelevant parts). Choose quotes that are highly representative, clear, and distinctive.]'''

            # Custom prompt input (show only if use_custom_prompt is checked)
            custom_prompt = ""
            if use_custom_prompt:
                st.markdown("**📝 Custom Prompt Mode**")
                st.markdown("Write your own analysis instructions. Examples: focus on specific departments, analyze sentiment, identify implementation barriers, etc.")

                # Show default prompt for reference
                with st.expander("View default prompt for reference"):
                    st.code(default_user_prompt, language="text")

                # Custom prompt text area
                custom_prompt = st.text_area(
                    "Enter your custom analysis prompt:",
                    height=200,
                    placeholder="Example: Analyze these ideas focusing on technology and digital transformation initiatives. Group similar suggestions and identify implementation challenges...",
                    help="Focus on your specific analysis needs. Background information about E3 platform and data format is automatically included."
                )

            # Get the list of participant IDs from the filtered dataframe
            participant_ids_with_ideas = participants_with_main_ideas['PARTICIPANT_ID'].unique().tolist()


            # Add button to generate analysis
            generate_button = st.button("Generate Main Ideas Analysis")


            if generate_button:
                # Check if we have a valid custom prompt when the toggle is on
                if use_custom_prompt and not custom_prompt.strip():
                    st.error("Please enter a custom prompt or uncheck 'Use custom prompt'.")
                else:
                    # Fetch main ideas analysis
                    with st.spinner(f"Generating analysis of {len(participant_ids_with_ideas)} main ideas... This may take a moment."):
                        # Use custom prompt if toggled on, otherwise use default
                        prompt_to_use = custom_prompt if use_custom_prompt else None
                        ideas_analysis = load_main_ideas_analysis(participant_ids_with_ideas, selected_llm, prompt_to_use)

                    if ideas_analysis.empty:
                        st.warning("No analysis data available for the main ideas.")
                    else:
                        # Get the first (and only) row
                        row = ideas_analysis.iloc[0]
                        # Display analysis header
                        st.subheader(f"Analysis of {row['N']} Main Ideas")

                        # Parse the JSON response
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
                            # Update the cost display in the first column
                            with col1:
                                st.info(f"The last query used {total_tokens:,} tokens and cost ${query_cost:.4f}")

                        # Display the analysis
                        st.markdown(analysis_text)

    # Source Data Tab
    with llm_tab2:
        st.subheader("Source Data")
        st.markdown("""
        Browse the participant responses that will be analyzed. This table shows all participants who provided main ideas,
        along with their department affiliation and other relevant details.
        """)

        # Display the participant responses with main ideas
        if participants_with_main_ideas.empty:
            st.warning("No participants with main ideas found.")
        else:
            # Display the data without requiring a button click
            st.info(f"Found {len(participants_with_main_ideas)} participants with main ideas")

            # Display the participants table
            display_columns = ['PARTICIPANT_ID', 'IDEA_DEPT', 'MAIN_IDEA', 'POS_TYPE', 'CA_TENURE', 'LAST_COMMENT_DATE']
            available_columns = [col for col in display_columns if col in participants_with_main_ideas.columns]

            st.dataframe(
                participants_with_main_ideas[available_columns],
                use_container_width=True,
                hide_index=True
            )

# Tab 2: Data Export
with tab2:
    st.subheader("Data Export")

    st.markdown("""
    Download the complete participant dataset for external analysis. The export includes all survey responses,
    comment text, demographic information, and participation timestamps.

    **What's included:** Participant IDs, survey responses (Point of Pride, Position Type, CA Tenure),
    comment text (Main Ideas, What's Working, Other Ideas), and activity dates.
    """)

    st.write(f"**Total records to export:** {len(filtered_df)}")

    if not filtered_df.empty:
        # Prepare export data
        export_df = filtered_df.copy()

        # Format dates for export
        if 'LAST_COMMENT_DATE' in export_df.columns:
            export_df['LAST_COMMENT_DATE'] = export_df['LAST_COMMENT_DATE'].dt.strftime('%Y-%m-%d %H:%M:%S')
        if 'LAST_SURVEY_RESPONSE_DATE' in export_df.columns:
            export_df['LAST_SURVEY_RESPONSE_DATE'] = export_df['LAST_SURVEY_RESPONSE_DATE'].dt.strftime('%Y-%m-%d %H:%M:%S')
        if '_FILE_UPLOAD_DATE' in export_df.columns:
            export_df['_FILE_UPLOAD_DATE'] = export_df['_FILE_UPLOAD_DATE'].dt.strftime('%Y-%m-%d %H:%M:%S')

        # CSV download
        csv_data = export_df.to_csv(index=False)
        st.download_button(
            label="Download Participant Responses as CSV",
            data=csv_data,
            file_name=f"e3_participant_responses_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
            mime="text/csv",
            use_container_width=True
        )

        # Preview of export data
        st.markdown("### Preview of Export Data")
        st.dataframe(export_df.head(10), use_container_width=True)

    else:
        st.warning("No data available for export with current filters.")

# Tab 3: Topic Modeling
with tab3:
    st.subheader("Topic Modeling Analysis")

    st.markdown("""
    Discover common themes across all participants' main ideas using automated text analysis.
    This helps identify the most frequent concerns and suggestions from state employees.
    """)

    # Import and run topic modeling
    try:
        from topic_modeling import run_topic_modeling_analysis
        run_topic_modeling_analysis(session)
    except ImportError as e:
        st.error(f"Error importing topic modeling module: {e}")
    except Exception as e:
        st.error(f"Error running topic modeling: {e}")

# Footer
st.markdown("---")
st.caption("E3 Comments Analysis Dashboard - Engaged California")
