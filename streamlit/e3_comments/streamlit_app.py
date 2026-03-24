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

#set llm model variables
llm_model_high = os.environ["LLM_MODEL_HIGH"]
llm_model_med = os.environ["LLM_MODEL_MED"]
llm_model_low = os.environ["LLM_MODEL_LOW"]


# Configuration settings
ENABLE_CUSTOM_PROMPT = True  # Set to True to enable custom prompt option


COST_PER_SNOWFLAKE_CREDIT = 3.16

# Define model costs (credits per 1 million tokens)
MODEL_CREDIT_COSTS = {
    llm_model_high: 2.55,
    llm_model_low: 0.25,
    llm_model_med: 0.96
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

- 🤖 **Generate AI-powered thematic analysis** of participant comments using advanced language models
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

# Load LLM analysis dynamically for any comment field
@st.cache_data
def load_comment_analysis(participant_ids, selected_llm, field_name, custom_prompt=None):
    """Load LLM analysis for any comment type (MAIN_IDEA, POINT_OF_PRIDE, WHATS_WORKING, OTHER_IDEAS)"""

    if not participant_ids:
        participant_ids_str = "''"
    else:
        participant_ids_str = "'" + "','".join(map(str, participant_ids)) + "'"

    system_prompt = '''You are analyzing ideas from participants in an E3 (Efficiency, Engagement, and Effectiveness) civic engagement platform. These are ideas for improving government services and operations from California state employees.

Each idea includes the department/agency it applies to. The ideas are semi-colon separated.

Always format your response in Markdown. Use headers, bullet points, and other markdown formatting to make your analysis clear and readable.
IMPORTANT: your response should be no more than 3000 words.'''

    default_user_prompt = '''Perform an open-coding analysis on these comments and identify 3–6 emerging themes.

Your output should follow this general format for each theme:

#### [Theme number]. [Theme Label]

*Description: [Theme description]*

*Representative quotes:*
    - [At least three representative, strictly verbatim quotes from the ideas (use ellipses [...] to trim irrelevant parts). Choose quotes that are highly representative, clear, and distinctive.]'''

    user_prompt_template = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else default_user_prompt

    query = f'''
    with comments as (
        select
            PARTICIPANT_ID,
            {field_name} as COMMENT_TEXT,
            IDEA_DEPT
        from ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_PARTICIPANT_RESPONSES
        where PARTICIPANT_ID in ({participant_ids_str})
        and {field_name} IS NOT NULL
        and TRIM({field_name}) != ''
    ),
    comments_agg as (
        select
            '{field_name} Analysis' as topics,
            count(*) as n,
            LISTAGG(COALESCE(IDEA_DEPT, 'Unspecified') || ': ' || COMMENT_TEXT, '; ') as target_ideas
        from comments
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
    from comments_agg a
    '''

    try:
        analysis_df = session.sql(query).to_pandas()
        return analysis_df
    except Exception as e:
        st.error(f"Error executing analysis query: {e}")
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
    st.subheader("LLM Analysis of Comments")

    st.markdown("""
    Select a model and click "Generate Analysis" to identify themes in participant responses.
    You can analyze different types of comments such as main ideas, points of pride, what's working, or other ideas.
    """)

    # Create sub-tabs for analysis and source data
    llm_tab1, llm_tab2 = st.tabs(["Idea Analysis", "Source Data"])

    with llm_tab1:
        st.markdown("""
        **Default Analysis:** The standard prompt performs open-coding analysis to identify 3-6 emerging themes with descriptions and representative quotes.

        **Custom Analysis:** Enable "Use custom prompt" below to create your own analysis approach (e.g., focus on specific topics, different analytical frameworks, sentiment analysis, etc.).
        """)

        # Dropdown to select comment type
        comment_type_options = {
            "Main Ideas": "MAIN_IDEA",
            "Points of Pride": "POINT_OF_PRIDE",
            "What's Working": "WHATS_WORKING",
            "Other Ideas": "OTHER_IDEAS"
        }
        col_dropdown, col_len, col_empty2 = st.columns([1, 1, 1])
        with col_dropdown:
            selected_comment_label = st.selectbox("Select comment type to analyze", list(comment_type_options.keys()))
        selected_comment_field = comment_type_options[selected_comment_label]

        # Filter participants with the selected field
        participants_with_comments = filtered_df[
            filtered_df[selected_comment_field].notna() & (filtered_df[selected_comment_field].str.strip() != '')
        ]
        with col_len:
            st.text("")  # for alignment
            st.info(f"Analyzing {len(participants_with_comments)} {selected_comment_label.lower()}")


        if participants_with_comments.empty:
            st.warning(f"No participants with {selected_comment_label.lower()} found.")
        else:
            # Define LLM options
            llm_options = [llm_model_low, llm_model_med, llm_model_high]

            # Define a function to map the actual values to display names
            def format_llm_option(option):
                if option == "llm_model_low":
                    return "Fast & Low-Cost Model"
                elif option == "llm_model_med":
                    return "Balanced option"
                elif option == "llm_model_high":
                    return "Most capable and costly"
                return option  # Fallback for any other options

            # Create columns for dropdowns and tips
            st.write("&nbsp;")  # Add space
            col1, col2, col3 = st.columns([1, 1, 1])  # Adjusted proportions

            with col1:
                # Add toggle for using custom prompt
                if ENABLE_CUSTOM_PROMPT:
                    use_custom_prompt = st.checkbox("Use custom prompt", value=False,
                        help="Enable this to write your own analysis instructions instead of using the default thematic analysis")
                else:
                    use_custom_prompt = False

                # Cost display area
                st.write("")  # space for alignment
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
            participant_ids_with_comments = participants_with_comments['PARTICIPANT_ID'].unique().tolist()

            # Add button to generate analysis
            generate_button = st.button("Generate Analysis")

            if generate_button:
                # Check if we have a valid custom prompt when the toggle is on
                if use_custom_prompt and not custom_prompt.strip():
                    st.error("Please enter a custom prompt or uncheck 'Use custom prompt'.")
                else:
                    with st.spinner(f"Generating analysis of {len(participant_ids_with_comments)} {selected_comment_label.lower()}... This may take a moment."):
                        # Use custom prompt if toggled on, otherwise use default
                        prompt_to_use = custom_prompt if use_custom_prompt else None

                        # Call the existing function, but dynamically pass the selected field
                        ideas_analysis = load_comment_analysis(participant_ids_with_comments, selected_llm, selected_comment_field, prompt_to_use)

                    if ideas_analysis.empty:
                        st.warning(f"No analysis data available for the {selected_comment_label.lower()}.")
                    else:
                        # Get the first (and only) row
                        row = ideas_analysis.iloc[0]
                        # Display analysis header
                        st.subheader(f"Analysis of {row['N']} {selected_comment_label}")

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
        st.markdown(f"""
        Browse the participant responses that will be analyzed. This table shows all participants who provided {selected_comment_label.lower()} comments,
        along with their department affiliation and other relevant details.
        """)

        # Display the participant responses with comments
        if participants_with_comments.empty:
            st.warning(f"No participants with {selected_comment_label.lower()} comments found.")
        else:
            # Display the data without requiring a button click
            st.info(f"Found {len(participants_with_comments)} participants with {selected_comment_label.lower()} comments.")

            # Display the participants table
            display_columns = ['PARTICIPANT_ID','IDEA_DEPT',selected_comment_field,'POS_TYPE','CA_TENURE','LAST_COMMENT_DATE']
            available_columns = [col for col in display_columns if col in participants_with_comments.columns]

            st.dataframe(
                participants_with_comments[available_columns],
                use_container_width=True,
                hide_index=True
            )

# Tab 2: Data Export
with tab2:
    st.subheader("Data Export")

    st.markdown("""
    Download the complete participant dataset for external analysis. The export includes all survey responses,
    comment text, demographic information, and participation timestamps.

    **What's included:** Participant IDs, survey responses (Position Type, CA Tenure),
    comment text (Main Ideas, Point of Pride, What's Working, Other Ideas), and activity dates.
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
            file_name=f"E3_PARTICIPANT_RESPONSES_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
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
    st.subheader("Topic Modeling Tables")

    st.markdown(
        """
        The topic modeling pipeline now runs in dbt. Use the tables below to explore results and download them for further analysis:
        - **`E3_TOPIC_THEMES`**: One row per topic with LLM-generated titles, descriptions, and representative quotes.
        - **`E3_TOPIC_CONTENTS`**: One row per idea, including the assigned topic, probability, and UMAP coordinates.

        **Content types:**
        - **Raw Main Idea** – individual main ideas submitted by employees.
        - **Processed Problem & Solution** – consolidated problem/solution pairs curated from the raw ideas with AI.
        """
    )

    content_type_options = [
        "All Content Types",
        "Raw Main Idea",
        "Processed Problem & Solution",
    ]
    col_dropdown, col_len, col_empty2 = st.columns([1, 1, 1])
    with col_dropdown:
        selected_topic_content_type = st.selectbox(
            "Filter by content type",
            content_type_options,
            key="topic_tables_content_type",
        )

    content_type_clause = ""
    escaped_value = selected_topic_content_type.replace("'", "''")
    if selected_topic_content_type != "All Content Types":
        content_type_clause = f"WHERE CONTENT_TYPE = '{escaped_value}'"

    # Load topic themes
    themes_query = f"""
        SELECT
            TOPIC_ID,
            CONTENT_TYPE,
            TOPIC_MEMBER_COUNT,
            TOPIC_NAME,
            TOPIC_DESCRIPTION,
            REPRESENTATIVE_QUOTES,
        FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_TOPIC_THEMES
        {content_type_clause}
        ORDER BY CONTENT_TYPE, TOPIC_ID
    """

    try:
        themes_df = session.sql(themes_query).to_pandas()
    except Exception as exc:
        st.error(f"Unable to load topic themes: {exc}")
        themes_df = pd.DataFrame()

    if not themes_df.empty:
        st.markdown("#### Topic Themes (`E3_TOPIC_THEMES`)")
        st.dataframe(themes_df, use_container_width=True, hide_index=True)

        themes_csv = themes_df.to_csv(index=False)
        st.download_button(
            label="Download Topic Themes",
            data=themes_csv,
            file_name=f"E3_TOPIC_THEMES_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
            mime="text/csv",
            use_container_width=True,
        )
    else:
        st.info("No topic themes available to display for the selected content type.")

    # Load topic contents
    contents_query = f"""
        SELECT
            CONTENT_TYPE,
            TOPIC_ID,
            TOPIC_NAME,
            CONTENT_ID,
            PARTICIPANT_ID,
            ORIGINAL_TEXT,
            TOPIC_PROBABILITY,
            IS_OUTLIER,
        FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_TOPIC_CONTENTS
        {content_type_clause}
        ORDER BY CONTENT_TYPE, CONTENT_ID
    """

    try:
        contents_df = session.sql(contents_query).to_pandas()
    except Exception as exc:
        st.error(f"Unable to load topic contents: {exc}")
        contents_df = pd.DataFrame()

    if not contents_df.empty:
        st.markdown("#### Topic Contents (`E3_TOPIC_CONTENTS`)")
        st.dataframe(contents_df, use_container_width=True, hide_index=True)

        contents_csv = contents_df.to_csv(index=False)
        st.download_button(
            label="Download Topic Contents",
            data=contents_csv,
            file_name=f"E3_TOPIC_CONTENTS_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
            mime="text/csv",
            use_container_width=True,
        )
    else:
        st.info("No topic content assignments available to display for the selected content type.")

# Footer
st.markdown("---")
st.caption("E3 Comments Analysis Dashboard - Engaged California")
