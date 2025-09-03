# Topic Modeling Module for E3 Comments Analysis
import streamlit as st
import numpy as np
import pandas as pd
import plotly.express as px
from datetime import datetime

def run_topic_modeling_analysis(session):
    """Main function to run topic modeling analysis"""

    # Check if required packages are available
    try:
        import optuna
        from bertopic import BERTopic
        from umap import UMAP
        from hdbscan import HDBSCAN
        from sklearn.metrics import silhouette_score, calinski_harabasz_score
        from sklearn.feature_extraction.text import CountVectorizer
        from sklearn.decomposition import PCA
        import re

        # Add explanation of optimization purpose
        st.markdown("""
        **How it works:** Choose your desired number of topic groups and how many ideas should be categorized.
        The system will find the best way to group similar ideas while meeting your preferences.
        """)

        # Configuration controls
        col1, col2 = st.columns(2)

        with col1:
            topic_range = st.slider(
                "Desired number of topics (range)",
                min_value=2, max_value=40, value=(5, 15),
                help="Range of topics the optimization should target"
            )
            # Enforce minimum range of 3
            if topic_range[1] - topic_range[0] < 3:
                st.warning("Please ensure at least a 3-topic range between min and max values.")
                topic_range = (topic_range[0], topic_range[0] + 3)

        with col2:
            classification_range = st.slider(
                "Classification percentage (range)",
                min_value=0.3, max_value=0.95, value=(0.45, 0.85), step=0.05,
                help="Range of documents that should be classified (not outliers)"
            )
            # Enforce minimum range of 0.3
            if classification_range[1] - classification_range[0] < 0.3:
                st.warning("Please ensure at least a 0.3 range between min and max classification percentages.")
                classification_range = (classification_range[0], classification_range[0] + 0.3)

        # Fixed number of optimization trials
        n_trials = 50

        # Load participant ideas for topic modeling
        @st.cache_data
        def load_topic_modeling_data():
            """Load participant main ideas for topic modeling"""
            query = '''
            SELECT
                PARTICIPANT_ID,
                MAIN_IDEA,
                IDEA_DEPT
            FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_PARTICIPANT_RESPONSES
            WHERE MAIN_IDEA IS NOT NULL
            AND TRIM(MAIN_IDEA) != ''
            ORDER BY PARTICIPANT_ID
            '''
            df = session.sql(query).to_pandas()
            return df

        # Generate embeddings for topic modeling
        @st.cache_data
        def generate_embeddings(ideas_list):
            """Generate embeddings for the ideas using Snowflake Cortex"""
            if not ideas_list:
                return np.array([])

            # Create individual VALUES rows for each idea
            values_rows = []
            for i, idea in enumerate(ideas_list):
                # Escape single quotes in the idea text
                escaped_idea = idea.replace("'", "''")
                values_rows.append(f"({i+1}, '{escaped_idea}')")

            values_clause = ", ".join(values_rows)

            query = f'''
            WITH ideas_data AS (
                SELECT column1 as idx, column2 as idea_text
                FROM VALUES {values_clause}
            )
            SELECT
                idx,
                idea_text,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('snowflake-arctic-embed-m-v1.5', idea_text) as embedding
            FROM ideas_data
            ORDER BY idx
            '''

            result_df = session.sql(query).to_pandas()

            # Convert embeddings to proper numpy array format
            embeddings_list = result_df['EMBEDDING'].tolist()

            # Convert each embedding to numpy array and stack them
            embeddings_arrays = []
            for emb in embeddings_list:
                if isinstance(emb, list):
                    embeddings_arrays.append(np.array(emb))
                else:
                    # If already numpy array, use as is
                    embeddings_arrays.append(emb)

            # Stack all embeddings into a 2D numpy array
            embeddings = np.stack(embeddings_arrays)

            return embeddings

        # Optimization scoring functions
        def score_topic_count(num_topics, target_min, target_max):
            if target_min <= num_topics <= target_max:
                return 1.0
            elif abs(num_topics - target_min) <= 1 or abs(num_topics - target_max) <= 1:
                return 0.7
            else:
                return 0.1

        def score_classified_percentage(classified_ratio, target_min, target_max):
            if target_min <= classified_ratio <= target_max:
                return 1.0
            elif target_min - 0.1 <= classified_ratio < target_min or target_max < classified_ratio <= target_max + 0.1:
                return 0.7
            else:
                return 0.1

        def normalize_silhouette_score(ss):
            return (ss + 1) / 2

        def normalize_calinski_harabasz_score(chs, C=5):
            return chs / (chs + C)

        # Optimization objective function
        def objective(trial, docs, embeddings, topic_min, topic_max, class_min, class_max):
            # Suppress optuna logging
            optuna.logging.set_verbosity(optuna.logging.WARNING)

            # Parameters to optimize
            umap_n_neighbors = trial.suggest_int('umap_n_neighbors', 3, 30)
            umap_n_components = 5  # Hardcoded to 5 for optimal performance
            umap_min_dist = 0.0  # Set to 0.0 for tighter clustering

            hdbscan_min_cluster_size = trial.suggest_int('hdbscan_min_cluster_size', 1, 15)
            hdbscan_min_samples = trial.suggest_int('hdbscan_min_samples', 1, 8)
            # Using default epsilon parameter

            # Create models
            umap_model = UMAP(
                n_neighbors=umap_n_neighbors,
                n_components=umap_n_components,
                min_dist=umap_min_dist,
                metric='cosine',
                random_state=42
            )

            hdbscan_model = HDBSCAN(
                min_cluster_size=hdbscan_min_cluster_size,
                min_samples=hdbscan_min_samples,
                cluster_selection_method='eom',
                prediction_data=True
                # Using default epsilon parameter
            )

            # Skip expensive operations during optimization
            topic_model = BERTopic(
                top_n_words=1,  # Minimal word extraction for faster optimization
                hdbscan_model=hdbscan_model,
                umap_model=umap_model,
                vectorizer_model=None,  # Skip vectorizer during optimization
                verbose=False,
                calculate_probabilities=False  # Skip probability calculation
            )

            try:
                # Ensure embeddings is proper numpy array
                if isinstance(embeddings, list):
                    embeddings_array = np.stack([np.array(emb) for emb in embeddings])
                else:
                    embeddings_array = embeddings

                topics, _ = topic_model.fit_transform(docs, embeddings_array)
                topic_info = topic_model.get_topic_info()
            except Exception as e:
                return -2

            # Calculate scores
            mask = [value != -1 for value in topics]
            if sum(mask) < 2:
                return -2

            assigned_embeddings = embeddings_array[mask]
            assigned_topics = np.array(topics)[mask]

            ss = silhouette_score(assigned_embeddings, assigned_topics)
            ss = normalize_silhouette_score(ss)

            chs = calinski_harabasz_score(assigned_embeddings, assigned_topics)
            chs = normalize_calinski_harabasz_score(chs)

            base_score = (ss + chs) / 2

            # Topic count and classification scoring
            num_topics = len(topic_info[topic_info.Topic != -1])
            topic_score = score_topic_count(num_topics, topic_min, topic_max)

            num_classified = sum(mask)
            classified_ratio = num_classified / len(docs)
            classification_score = score_classified_percentage(classified_ratio, class_min, class_max)

            final_score = base_score * topic_score * classification_score
            return final_score

        def wrap_text(text, max_length=50):
            """Wrap text to specified length with HTML line breaks"""
            if len(text) <= max_length:
                return text

            words = text.split()
            lines = []
            current_line = []
            current_length = 0

            for word in words:
                if current_length + len(word) + 1 <= max_length:
                    current_line.append(word)
                    current_length += len(word) + 1
                else:
                    if current_line:
                        lines.append(' '.join(current_line))
                    current_line = [word]
                    current_length = len(word)

            if current_line:
                lines.append(' '.join(current_line))

            return '<br>'.join(lines)

        # Run topic modeling button
        if st.button("Run Topic Modeling Analysis"):
            with st.spinner("Loading participant data..."):
                topic_data = load_topic_modeling_data()

            if topic_data.empty:
                st.warning("No participant ideas found for topic modeling.")
            else:
                st.info(f"Found {len(topic_data)} participant ideas for analysis")

                docs = topic_data['MAIN_IDEA'].tolist()

                with st.spinner("Generating embeddings..."):
                    embeddings = generate_embeddings(docs)

                if embeddings.size == 0:
                    st.error("Failed to generate embeddings")
                else:
                    # Apply PCA to reduce to 200 dimensions for faster optimization
                    with st.spinner("Applying dimensionality reduction..."):
                        pca = PCA(n_components=200, random_state=42)
                        embeddings_pca = pca.fit_transform(embeddings)

                    with st.spinner(f"Finding optimal topic groupings ({n_trials} trials)..."):
                        study = optuna.create_study(direction='maximize', study_name="e3_topic_optimization")
                        study.optimize(
                            lambda trial: objective(
                                trial, docs, embeddings_pca,
                                topic_range[0], topic_range[1],
                                classification_range[0], classification_range[1]
                            ),
                            n_trials=n_trials
                        )

                    if study.best_value == -2:
                        st.error("""
                        **Topic Discovery Failed**: Unable to find suitable groupings for your desired topic count and classification rate.

                        **Try adjusting your settings:**
                        - Increase the topic range (allow for more and/or fewer topics)
                        - Adjust the classification percentage range
                        """)
                    else:
                        st.success("✅ Topic analysis complete!")

                        # Apply best parameters
                        best_params = study.best_params

                        with st.spinner("Generating final topic model..."):
                            # Create final model with best parameters
                            final_umap = UMAP(
                                n_neighbors=best_params['umap_n_neighbors'],
                                n_components=5,  # Hardcoded to 5 for optimal performance
                                min_dist=0.0,  # Set to 0.0 for tighter clustering
                                metric='cosine',
                                random_state=42
                            )

                            final_hdbscan = HDBSCAN(
                                min_cluster_size=best_params['hdbscan_min_cluster_size'],
                                min_samples=best_params['hdbscan_min_samples'],
                                cluster_selection_method='eom',
                                prediction_data=True
                                # Using default epsilon parameter
                            )

                            final_vectorizer = CountVectorizer(
                                stop_words='english',
                                min_df=0.01,
                                max_df=0.5,
                                ngram_range=(1, 2)
                            )

                            final_topic_model = BERTopic(
                                top_n_words=10,
                                hdbscan_model=final_hdbscan,
                                umap_model=final_umap,
                                vectorizer_model=final_vectorizer,
                                verbose=False
                            )

                            # Use PCA embeddings for final model
                            topics, probs = final_topic_model.fit_transform(docs, embeddings_pca)
                            topic_info = final_topic_model.get_topic_info()

                            # Check if the actual number of topics falls within the desired range
                            actual_num_topics = len(topic_info[topic_info.Topic != -1])
                            if actual_num_topics < topic_range[0] or actual_num_topics > topic_range[1]:
                                st.warning(f"""
                                Optimization was unable to find parameters to generate the desired range of {topic_range[0]}-{topic_range[1]} topics.

                                **Recommendation**: Try expanding your topic range
                                """)
                            else:
                                st.success(f"✅ Found {actual_num_topics} topics within your desired range of {topic_range[0]}-{topic_range[1]}")

                            # Generate topic labels and descriptions using LLM
                            topic_labels = {}
                            topic_descriptions = {}
                            for _, row in topic_info.iterrows():
                                if row['Topic'] != -1:
                                    topic_docs = [docs[i] for i, t in enumerate(topics) if t == row['Topic']]
                                    if topic_docs:
                                        # Sample up to 10 documents for labeling
                                        sample_docs = topic_docs[:10]
                                        docs_text = '; '.join(sample_docs)

                                        label_query = f'''
                                        SELECT SNOWFLAKE.CORTEX.COMPLETE(
                                            'llama4-maverick',
                                            'The following are ideas from California state employees for improving government efficiency, engagement, and effectiveness. Please analyze these ideas and provide:

1. TOPIC TITLE: A brief 2-6 word topic title that captures the main theme. Avoid generic words like government, efficiency, streamline, engage, improve, etc. Focus on the specific throughline problem and/or solution across the ideas.

2. TOPIC DESCRIPTION: A topic description of maximum 3 sentences that summarizes the common theme across these ideas. Be specific about the problems identified and solutions proposed.

3. REPRESENTATIVE QUOTES: Include 2-3 representative quotes (about one sentence each) that best capture people's sentiment and ideas on the topic. Extract exactly from the source comments but you can make minimal edits for clarity and brevity while maintaining the original voice. You may:
   - Remove irrelevant details using ellipses (...)
   - Add clarifying words in brackets [like this]
   - Condense longer passages to focus on the key point
   - Preserve the authentic tone and perspective of the original commenter

Ideas: ' || '{docs_text.replace("'", "''")}',
                                            response_format => {{
                                                'type': 'json',
                                                'schema': {{
                                                    'type': 'object',
                                                    'properties': {{
                                                        'title': {{
                                                            'type': 'string'
                                                        }},
                                                        'description': {{
                                                            'type': 'string'
                                                        }},
                                                        'quotes': {{
                                                            'type': 'array',
                                                            'items': {{
                                                                'type': 'string'
                                                            }}
                                                        }}
                                                    }},
                                                    'required': ['title', 'description', 'quotes']
                                                }}
                                            }}
                                        ) as topic_analysis
                                        '''

                                        try:
                                            label_result = session.sql(label_query).to_pandas()
                                            analysis_text = label_result.iloc[0]['TOPIC_ANALYSIS']

                                            # Parse JSON response directly
                                            import json
                                            analysis_json = json.loads(analysis_text)

                                            topic_labels[row['Topic']] = analysis_json.get('title', f"Topic {row['Topic']}")

                                            description = analysis_json.get('description', 'No description available')
                                            quotes = analysis_json.get('quotes', [])

                                            if quotes:
                                                quotes_text = '\n'.join([f'- "{quote}"' for quote in quotes])
                                                topic_descriptions[row['Topic']] = f"{description}\n\nRepresentative examples:\n{quotes_text}"
                                            else:
                                                topic_descriptions[row['Topic']] = description

                                        except Exception as e:
                                            topic_labels[row['Topic']] = f"Topic {row['Topic']}"
                                            topic_descriptions[row['Topic']] = "No description available"

                            # Create visualization
                            umap_2d = UMAP(
                                n_neighbors=15,
                                n_components=2,
                                min_dist=0.1,
                                target_weight=0.5,
                                random_state=42
                            )

                            topic_labels_for_umap = np.array(topics, dtype=np.int_)
                            if not np.all(topic_labels_for_umap == -1):
                                umap_2d_embeddings = umap_2d.fit_transform(embeddings_pca, y=topic_labels_for_umap)
                            else:
                                umap_2d_embeddings = umap_2d.fit_transform(embeddings_pca)

                            # Create visualization dataframe with wrapped text
                            wrapped_ideas = [wrap_text(idea, 50) for idea in topic_data['MAIN_IDEA']]

                            # Create combined hover text with topic, description, and idea
                            hover_text = []
                            for i, row in enumerate(topic_data.itertuples()):
                                topic_label = topic_labels.get(topics[i], 'Outlier') if topics[i] != -1 else 'Outlier'
                                topic_desc = topic_descriptions.get(topics[i], 'No description available') if topics[i] != -1 else 'Outliers - ideas that don\'t fit clearly into any topic'
                                hover_text.append(f"<b>{topic_label}</b><br><br>{topic_desc}<br><br><b>This idea:</b><br>{wrapped_ideas[i]}")

                            viz_df = pd.DataFrame({
                                'PARTICIPANT_ID': topic_data['PARTICIPANT_ID'],
                                'MAIN_IDEA': topic_data['MAIN_IDEA'],
                                'MAIN_IDEA_WRAPPED': wrapped_ideas,
                                'HOVER_TEXT': hover_text,
                                'IDEA_DEPT': topic_data['IDEA_DEPT'].fillna('Unspecified'),
                                'TOPIC': topics,
                                'TOPIC_LABEL': [topic_labels.get(t, 'Outlier') if t != -1 else 'Outlier' for t in topics],
                                'TOPIC_DESCRIPTION': [topic_descriptions.get(t, 'Outliers - ideas that don\'t fit clearly into any topic') if t != -1 else 'Outliers - ideas that don\'t fit clearly into any topic' for t in topics],
                                'UMAP_1': umap_2d_embeddings[:, 0],
                                'UMAP_2': umap_2d_embeddings[:, 1]
                            })

                            # Center coordinates
                            viz_df['UMAP_1_centered'] = viz_df['UMAP_1'] - viz_df['UMAP_1'].mean()
                            viz_df['UMAP_2_centered'] = viz_df['UMAP_2'] - viz_df['UMAP_2'].mean()

                            # Create plot with wrapped hover text
                            custom_colors = [
                                '#1abc9c', '#3498db', '#9b59b6', '#e74c3c', '#f39c12',
                                '#f1c40f', '#2ecc71', '#34495e', '#e67e22', '#d35400'
                            ]

                            # Order topics by size
                            topic_counts = viz_df['TOPIC_LABEL'].value_counts()
                            ordered_topics = topic_counts.index.tolist()
                            if 'Outlier' in ordered_topics:
                                ordered_topics.remove('Outlier')
                                ordered_topics.append('Outlier')

                            color_map = {topic: color for topic, color in zip(ordered_topics[:-1], custom_colors)}
                            color_map['Outlier'] = '#D3D3D3'

                            fig = px.scatter(
                                viz_df,
                                x='UMAP_1_centered',
                                y='UMAP_2_centered',
                                color='TOPIC_LABEL',
                                color_discrete_map=color_map,
                                custom_data=['HOVER_TEXT'],
                                title='E3 Participant Ideas - Topic Landscape',
                                opacity=0.7,
                                category_orders={'TOPIC_LABEL': ordered_topics}
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
                                legend_title="Topics"
                            )

                            st.plotly_chart(fig, use_container_width=True)

                            # Display topic summary
                            st.subheader("Topic Summary")

                            # Create a more comprehensive topic summary
                            topic_summary_data = []
                            for topic_label in viz_df['TOPIC_LABEL'].unique():
                                if topic_label != 'Outlier':
                                    topic_id = viz_df[viz_df['TOPIC_LABEL'] == topic_label]['TOPIC'].iloc[0]
                                    count = len(viz_df[viz_df['TOPIC_LABEL'] == topic_label])
                                    description = topic_descriptions.get(topic_id, 'No description available')

                                    # Extract just the description part (before "Representative examples:")
                                    desc_parts = description.split('\n\nRepresentative examples:')
                                    topic_desc = desc_parts[0]
                                    quotes = desc_parts[1] if len(desc_parts) > 1 else 'No quotes available'

                                    topic_summary_data.append({
                                        'Topic Label': topic_label,
                                        'Count': count,
                                        'Topic Description': topic_desc,
                                        'Representative Quotes': quotes
                                    })

                            # Add outliers row if they exist
                            outlier_count = len(viz_df[viz_df['TOPIC_LABEL'] == 'Outlier'])
                            if outlier_count > 0:
                                topic_summary_data.append({
                                    'Topic Label': 'Outlier',
                                    'Count': outlier_count,
                                    'Topic Description': 'Ideas that don\'t fit clearly into any specific topic',
                                    'Representative Quotes': 'N/A'
                                })

                            topic_summary_df = pd.DataFrame(topic_summary_data)
                            st.dataframe(topic_summary_df, use_container_width=True, hide_index=True)

                            # Display detailed results table with topic filter
                            st.subheader("Detailed Results")

                            # Create topic selection dropdown
                            topic_options = ['All Topics'] + sorted([t for t in viz_df['TOPIC_LABEL'].unique() if t != 'Outlier']) + (['Outlier'] if 'Outlier' in viz_df['TOPIC_LABEL'].unique() else [])
                            selected_topic = st.selectbox('Select a topic to filter:', topic_options)

                            # Filter dataframe based on selection
                            if selected_topic == 'All Topics':
                                filtered_df = viz_df[['MAIN_IDEA']].copy()
                                filtered_df.columns = ['Main Idea']
                            else:
                                filtered_df = viz_df[viz_df['TOPIC_LABEL'] == selected_topic][['MAIN_IDEA']].copy()
                                filtered_df.columns = ['Main Idea']

                            st.dataframe(filtered_df, use_container_width=True, hide_index=True)

                            # Download option
                            csv_data = viz_df.to_csv(index=False)
                            st.download_button(
                                label="Download Topic Modeling Results",
                                data=csv_data,
                                file_name=f"e3_topic_modeling_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                                mime="text/csv",
                                use_container_width=True
                            )

    except ImportError as e:
        st.error(f"""
        Required packages not available for topic modeling: {e}

        The following packages are needed:
        - bertopic
        - umap-learn
        - hdbscan
        - optuna
        - scikit-learn

        Please install these packages in your Snowflake environment.
        """)
