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

from topic_modeling import (
    get_available_content_types,
    load_embeddings_data,
    extract_embeddings_array,
    reduce_embeddings,
    optimize_topic_model,
    build_final_topic_model,
    generate_topic_labels,
    compute_2d_embeddings,
    create_visualization_dataframe,
    build_topic_summary,
)

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

    st.markdown(
        """
        **How it works:** Choose your desired number of topic groups and how many ideas should be categorized.
        The system searches for the best grouping while trying to satisfy your preferences.
        """
    )

    if 'topic_modeling_results' not in st.session_state:
        st.session_state.topic_modeling_results = None

    # Content type selection
    try:
        content_type_options = get_available_content_types(session)
    except Exception as e:
        st.warning(f"Unable to load content types: {e}")
        content_type_options = []

    if not content_type_options:
        content_type_options = ['MAIN_IDEA']

    default_index = content_type_options.index('MAIN_IDEA') if 'MAIN_IDEA' in content_type_options else 0
    selected_content_type = st.selectbox(
        "Select content type",
        content_type_options,
        index=default_index,
        key="topic_modeling_content_type"
    )

    control_col1, control_col2 = st.columns(2)
    topic_range = control_col1.slider(
        "Desired number of topics (range)",
        min_value=2,
        max_value=40,
        value=(5, 15),
        help="Range of topics the optimization should target"
    )
    if topic_range[1] - topic_range[0] < 3:
        control_col1.warning("Please ensure at least a 3-topic range between min and max values.")

    classification_range = control_col2.slider(
        "Classification percentage (range)",
        min_value=0.3,
        max_value=0.95,
        value=(0.45, 0.85),
        step=0.05,
        help="Range of documents that should be classified (not outliers)"
    )
    if classification_range[1] - classification_range[0] < 0.3:
        control_col2.warning("Please ensure at least a 0.3 range between min and max classification percentages.")

    n_trials = 10

    if st.button("Run Topic Modeling Analysis", use_container_width=True):
        results = {
            'status': None,
            'message': None,
            'warnings': [],
            'content_type': selected_content_type,
        }

        try:
            with st.spinner("Loading embeddings data..."):
                embeddings_df = load_embeddings_data(session, selected_content_type)

            if embeddings_df.empty:
                results.update({
                    'status': 'warning',
                    'message': "No participant ideas found for topic modeling.",
                })
            else:
                docs = embeddings_df['ORIGINAL_TEXT'].tolist()
                embeddings = extract_embeddings_array(embeddings_df)

                if embeddings.size == 0:
                    results.update({
                        'status': 'error',
                        'message': "Failed to extract embeddings for the selected content type.",
                    })
                else:
                    with st.spinner("Reducing embedding dimensionality..."):
                        embeddings_pca = reduce_embeddings(embeddings)

                    with st.spinner(f"Finding optimal topic groupings ({n_trials} trials)..."):
                        study = optimize_topic_model(
                            docs,
                            embeddings_pca,
                            topic_range,
                            classification_range,
                            n_trials=n_trials,
                        )

                    if study.best_value == -2:
                        results.update({
                            'status': 'error',
                            'message': (
                                "**Topic Discovery Failed**: Unable to find suitable groupings for your desired "
                                "topic count and classification rate."
                            ),
                        })
                        results['warnings'].append(
                            "Try increasing the topic range or adjusting the classification percentage range."
                        )
                    else:
                        best_params = study.best_params

                        with st.spinner("Training final topic model..."):
                            _, topics, _, topic_info = build_final_topic_model(
                                docs,
                                embeddings_pca,
                                best_params,
                            )

                        actual_num_topics = len(topic_info[topic_info.Topic != -1])
                        classified_mask = [topic != -1 for topic in topics]
                        classified_ratio = (
                            sum(classified_mask) / len(topics) if topics else 0.0
                        )

                        with st.spinner("Generating topic labels..."):
                            topic_labels, topic_descriptions, label_errors = generate_topic_labels(
                                session,
                                docs,
                                topics,
                                topic_info,
                                selected_content_type
                            )

                        embeddings_2d = compute_2d_embeddings(embeddings_pca, topics)
                        viz_df = create_visualization_dataframe(
                            embeddings_df,
                            list(topics),
                            embeddings_2d,
                            topic_labels,
                            topic_descriptions,
                        )
                        topic_summary_df = build_topic_summary(viz_df)

                        results.update({
                            'status': 'success',
                            'message': "Topic analysis complete!",
                            'viz_df': viz_df,
                            'topic_summary_df': topic_summary_df,
                            'topic_labels': topic_labels,
                            'topic_descriptions': topic_descriptions,
                            'label_errors': label_errors,
                            'actual_num_topics': actual_num_topics,
                            'topic_range': topic_range,
                            'classified_ratio': classified_ratio,
                            'best_params': best_params,
                            'study_best_value': study.best_value,
                        })

                        if actual_num_topics < topic_range[0] or actual_num_topics > topic_range[1]:
                            results['warnings'].append(
                                (
                                    f"Optimization produced {actual_num_topics} topics, which is outside the requested "
                                    f"range of {topic_range[0]}–{topic_range[1]}."
                                )
                            )

        except ImportError as e:
            results.update({
                'status': 'error',
                'message': f"Required packages not available for topic modeling: {e}",
            })
            results['warnings'].extend([
                'The following packages are needed: bertopic, umap-learn, hdbscan, optuna, scikit-learn.',
                'Please install these packages in your Snowflake environment.',
            ])
        except Exception as e:
            results.update({
                'status': 'error',
                'message': f"Error running topic modeling: {e}",
            })

        st.session_state.topic_modeling_results = results

    results = st.session_state.get('topic_modeling_results')

    if results:
        status = results.get('status')
        message = results.get('message')
        warnings_list = results.get('warnings', [])

        if status == 'success' and message:
            st.success(message)
        elif status == 'warning' and message:
            st.warning(message)
        elif status == 'error' and message:
            st.error(message)

        for warning_text in warnings_list:
            st.warning(warning_text)

        label_errors = results.get('label_errors', [])
        if label_errors:
            for err in label_errors:
                st.warning(f"Topic labeling fallback used: {err}")

        viz_df = results.get('viz_df')

        if isinstance(viz_df, pd.DataFrame) and not viz_df.empty:
            st.caption(f"Content type analyzed: {results.get('content_type', selected_content_type)}")

            actual_num_topics = results.get('actual_num_topics', 0)
            classified_ratio = results.get('classified_ratio', 0.0)
            st.info(
                f"Identified {actual_num_topics} topics. "
                f"{classified_ratio * 100:.1f}% of ideas were classified into a topic."
            )

            required_columns = {'UMAP_1_centered', 'UMAP_2_centered', 'TOPIC_LABEL', 'HOVER_TEXT'}
            if required_columns.issubset(viz_df.columns):
                custom_colors = [
                    '#1abc9c', '#3498db', '#9b59b6', '#e74c3c', '#f39c12',
                    '#f1c40f', '#2ecc71', '#34495e', '#e67e22', '#d35400'
                ]

                topic_counts = viz_df['TOPIC_LABEL'].value_counts()
                ordered_topics = topic_counts.index.tolist()
                if 'Outlier' in ordered_topics:
                    ordered_topics.remove('Outlier')
                    ordered_topics.append('Outlier')

                from itertools import cycle

                color_cycle = cycle(custom_colors)
                color_map = {topic: next(color_cycle) for topic in ordered_topics if topic != 'Outlier'}
                color_map['Outlier'] = '#D3D3D3'

                fig = px.scatter(
                    viz_df,
                    x='UMAP_1_centered',
                    y='UMAP_2_centered',
                    color='TOPIC_LABEL',
                    custom_data=['HOVER_TEXT'],
                    title='E3 Participant Ideas - Topic Landscape',
                    opacity=0.7,
                    category_orders={'TOPIC_LABEL': ordered_topics},
                    color_discrete_map=color_map,
                )

                fig.update_traces(
                    hovertemplate='%{customdata[0]}<extra></extra>',
                    marker=dict(size=8)
                )

                fig.update_xaxes(showticklabels=False, title='', showgrid=False, zeroline=False)
                fig.update_yaxes(showticklabels=False, title='', showgrid=False, zeroline=False)
                fig.update_layout(
                    hoverlabel=dict(font_size=14),
                    dragmode='zoom',
                    hovermode='closest',
                    margin=dict(l=20, r=20, t=40, b=20),
                    legend_title="Topics",
                )

                st.plotly_chart(fig, use_container_width=True)

            topic_summary_df = results.get('topic_summary_df', pd.DataFrame())
            if not topic_summary_df.empty:
                st.subheader("Topic Summary")
                st.dataframe(topic_summary_df, use_container_width=True, hide_index=True)

            st.subheader("Detailed Results")

            topic_labels_sorted = [
                label for label in sorted(viz_df['TOPIC_LABEL'].unique()) if label != 'Outlier'
            ]
            if 'Outlier' in viz_df['TOPIC_LABEL'].unique():
                topic_labels_sorted.append('Outlier')

            topic_options = ['All Topics'] + topic_labels_sorted
            selected_topic_label = st.selectbox(
                'Select a topic to filter:',
                topic_options,
                key=f"topic_filter_{results.get('content_type', 'default')}"
            )

            if selected_topic_label == 'All Topics':
                detail_df = viz_df[['ORIGINAL_TEXT']].copy()
            else:
                detail_df = viz_df[viz_df['TOPIC_LABEL'] == selected_topic_label][['ORIGINAL_TEXT']].copy()

            detail_df.rename(columns={'ORIGINAL_TEXT': 'Idea Text'}, inplace=True)
            st.dataframe(detail_df, use_container_width=True, hide_index=True)

            csv_data = viz_df.to_csv(index=False)
            st.download_button(
                label="Download Topic Modeling Results",
                data=csv_data,
                file_name=f"e3_topic_modeling_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True,
            )

        elif status == 'success':
            st.info("No topic modeling results to display.")

# Footer
st.markdown("---")
st.caption("E3 Comments Analysis Dashboard - Engaged California")
