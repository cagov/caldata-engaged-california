# Topic Modeling Backend Functions for E3 Comments Analysis
import numpy as np
import pandas as pd

def get_available_content_types(session):
    """Return distinct content types that have embeddings available."""
    query = '''
    SELECT DISTINCT CONTENT_TYPE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_EMBEDDINGS_UNIFIED
    WHERE CONTENT_TYPE IS NOT NULL
    ORDER BY CONTENT_TYPE
    '''
    df = session.sql(query).to_pandas()
    return df['CONTENT_TYPE'].dropna().tolist()


def load_embeddings_data(session, selected_content_type):
    """Load pre-calculated embeddings and content from e3_embeddings_unified table"""
    safe_content_type = selected_content_type.replace("'", "''")
    query = f'''
    SELECT
        CONTENT_ID,
        PARTICIPANT_ID,
        CONTENT_TYPE,
        ORIGINAL_TEXT,
        DEPARTMENTS,
        EMBEDDING_VECTOR,
        _FILE_UPLOAD_DATE
    FROM ANALYTICS_ENGCA_PRD.ETHELO_E3.E3_EMBEDDINGS_UNIFIED
    WHERE CONTENT_TYPE = '{safe_content_type}'
    AND ORIGINAL_TEXT IS NOT NULL
    AND TRIM(ORIGINAL_TEXT) != ''
    ORDER BY CONTENT_ID
    '''
    df = session.sql(query).to_pandas()
    return df

def extract_embeddings_array(embeddings_df):
    """Convert embedding vectors from DataFrame to numpy array"""
    if embeddings_df.empty:
        return np.array([])

    # Extract embedding vectors and convert to numpy array
    embeddings_list = embeddings_df['EMBEDDING_VECTOR'].tolist()

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

def score_topic_count(num_topics, target_min, target_max):
    """Score the number of topics based on target range"""
    if target_min <= num_topics <= target_max:
        return 1.0
    elif abs(num_topics - target_min) <= 1 or abs(num_topics - target_max) <= 1:
        return 0.7
    else:
        return 0.1

def score_classified_percentage(classified_ratio, target_min, target_max):
    """Score the classification percentage based on target range"""
    if target_min <= classified_ratio <= target_max:
        return 1.0
    elif target_min - 0.1 <= classified_ratio < target_min or target_max < classified_ratio <= target_max + 0.1:
        return 0.7
    else:
        return 0.1

def normalize_silhouette_score(ss):
    """Normalize silhouette score to 0-1 range"""
    return (ss + 1) / 2

def normalize_calinski_harabasz_score(chs, C=5):
    """Normalize Calinski-Harabasz score"""
    return chs / (chs + C)

def objective(trial, docs, embeddings, topic_min, topic_max, class_min, class_max):
    """Optimization objective function for topic modeling"""
    # Import required packages inside function to avoid import issues
    import optuna
    from bertopic import BERTopic
    from umap import UMAP
    from hdbscan import HDBSCAN
    from sklearn.metrics import silhouette_score, calinski_harabasz_score

    # Suppress optuna logging
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # Parameters to optimize
    umap_n_neighbors = trial.suggest_int('umap_n_neighbors', 3, 30)
    umap_n_components = 5  # Hardcoded to 5 for optimal performance
    umap_min_dist = 0.0  # Set to 0.0 for tighter clustering

    hdbscan_min_cluster_size = trial.suggest_int('hdbscan_min_cluster_size', 1, 15)
    hdbscan_min_samples = trial.suggest_int('hdbscan_min_samples', 1, 8)

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


def reduce_embeddings(embeddings, max_components=200, random_state=42):
    """Reduce embedding dimensionality using PCA if needed."""
    from sklearn.decomposition import PCA

    if embeddings.size == 0:
        return embeddings

    # If embeddings already have fewer dimensions than requested, return as-is
    if embeddings.ndim == 1 or embeddings.shape[1] <= max_components:
        return embeddings

    n_components = min(max_components, embeddings.shape[1])
    pca = PCA(n_components=n_components, random_state=random_state)
    return pca.fit_transform(embeddings)


def optimize_topic_model(docs, embeddings, topic_range, classification_range, n_trials=50, study_name="e3_topic_optimization"):
    """Run Optuna optimization to determine the best topic modeling parameters."""
    import optuna

    topic_min, topic_max = topic_range
    class_min, class_max = classification_range

    def _objective(trial):
        return objective(trial, docs, embeddings, topic_min, topic_max, class_min, class_max)

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction='maximize', study_name=study_name)
    study.optimize(_objective, n_trials=n_trials)
    return study


def build_final_topic_model(docs, embeddings, best_params):
    """Train the final BERTopic model using the best optimization parameters."""
    from bertopic import BERTopic
    from umap import UMAP
    from hdbscan import HDBSCAN
    from sklearn.feature_extraction.text import CountVectorizer

    umap_model = UMAP(
        n_neighbors=best_params['umap_n_neighbors'],
        n_components=5,
        min_dist=0.0,
        metric='cosine',
        random_state=42
    )

    hdbscan_model = HDBSCAN(
        min_cluster_size=best_params['hdbscan_min_cluster_size'],
        min_samples=best_params['hdbscan_min_samples'],
        cluster_selection_method='eom',
        prediction_data=True
    )

    vectorizer_model = CountVectorizer(stop_words='english', min_df=5, max_df=0.95)

    topic_model = BERTopic(
        hdbscan_model=hdbscan_model,
        umap_model=umap_model,
        vectorizer_model=vectorizer_model,
        top_n_words=10,
        verbose=False,
        calculate_probabilities=True
    )

    topics, probs = topic_model.fit_transform(docs, embeddings)
    topic_info = topic_model.get_topic_info()

    return topic_model, topics, probs, topic_info


def generate_topic_labels(session, docs, topics, topic_info, content_type, sample_size=10, model_name='claude-4-sonnet'):
    """Use an LLM to generate human-readable labels and descriptions for topics."""
    import json

    topic_labels = {}
    topic_descriptions = {}
    label_errors = []

    response_format_literal = """{
            'type':'json',
            'schema':{
                'type':'object',
                'properties':{
                    'title':{'type':'string'},
                    'description':{'type':'string'},
                    'quotes':{
                        'type':'array',
                        'items':{'type':'string'}
                    }
                },
                'required':['title','description','quotes']
            }
        }"""

    content_context = (
        "original participant ideas for improving government services"
        if str(content_type).lower() in {"raw main idea", "main_idea", "main idea"}
        else "AI-processed problem-solution pairs extracted from participant comments"
    )

    prompt_prefix = (
        "The following are content items from California state employees participating in an E3 (Efficiency, "
        "Engagement, and Effectiveness) civic engagement platform. These items represent "
        f"{content_context}. Analyze the items and return a JSON object with: \n"
        "- `title`: a concise 2-6 word topic title that avoids generic terms like government, efficiency, streamline, engage, or improve.\n"
        "- `description`: no more than three sentences summarizing the common theme, focusing on specific problems and solutions.\n"
        "- `quotes`: an array of 2-3 representative quotes (each about one sentence) drawn from the content. Quotes may use ellipses or bracketed clarifications but must stay true to the source.\n\n"
        "Content items: "
    )

    for _, row in topic_info.iterrows():
        topic_id = row['Topic']
        if topic_id == -1:
            continue

        topic_docs = [docs[i] for i, topic_assignment in enumerate(topics) if topic_assignment == topic_id]
        if not topic_docs:
            topic_labels[topic_id] = f"Topic {topic_id}"
            topic_descriptions[topic_id] = "No description available"
            continue

        sample_docs = topic_docs[:sample_size]
        docs_text = '; '.join(sample_docs)
        prompt_safe = prompt_prefix.replace("'", "''")
        docs_text_safe = docs_text.replace("'", "''")

        label_query = f'''
        SELECT AI_COMPLETE(
            model => '{model_name}',
            prompt => '{prompt_safe}' || '{docs_text_safe}',
            model_parameters => {{
                'temperature': 0.01
            }},
            response_format => {response_format_literal}
        ) AS topic_analysis;
        '''

        try:
            label_result = session.sql(label_query).to_pandas()
            analysis_text = label_result.iloc[0]['TOPIC_ANALYSIS']
            analysis_json = json.loads(analysis_text)
        except Exception as exc:
            topic_labels[topic_id] = f"Topic {topic_id}"
            topic_descriptions[topic_id] = "No description available"
            label_errors.append(str(exc))
            continue

        topic_labels[topic_id] = analysis_json.get('title', f"Topic {topic_id}")

        description = analysis_json.get('description', 'No description available')
        quotes = analysis_json.get('quotes', [])

        if quotes:
            quotes_text = '\n'.join([f'- "{quote}"' for quote in quotes])
            topic_descriptions[topic_id] = f"{description}\n\nRepresentative examples:\n{quotes_text}"
        else:
            topic_descriptions[topic_id] = description

    return topic_labels, topic_descriptions, label_errors


def compute_2d_embeddings(embeddings, topics, random_state=42):
    """Project embeddings to two dimensions for visualization."""
    from umap import UMAP

    if embeddings.size == 0:
        return np.array([])

    umap_2d = UMAP(
        n_neighbors=15,
        n_components=2,
        min_dist=0.1,
        target_weight=0.5,
        random_state=random_state
    )

    topic_array = np.array(topics, dtype=np.int_)
    if topic_array.size == 0:
        return np.array([])

    if np.all(topic_array == -1):
        return umap_2d.fit_transform(embeddings)

    return umap_2d.fit_transform(embeddings, y=topic_array)


def create_visualization_dataframe(topic_df, topics, embeddings_2d, topic_labels, topic_descriptions):
    """Prepare dataframe used for visualization and downstream tables."""
    if topic_df.empty:
        return pd.DataFrame()

    wrapped_text = [wrap_text(text, 50) for text in topic_df['ORIGINAL_TEXT']]

    hover_text = []
    for idx, row in enumerate(topic_df.itertuples(index=False)):
        topic_id = topics[idx] if idx < len(topics) else -1
        label = topic_labels.get(topic_id, 'Outlier') if topic_id != -1 else 'Outlier'
        description = (
            topic_descriptions.get(topic_id, "Outliers - ideas that don't fit clearly into any topic")
            if topic_id != -1 else "Outliers - ideas that don't fit clearly into any topic"
        )
        hover_text.append(
            f"<b>{label}</b><br><br>{description}<br><br><b>This idea:</b><br>{wrapped_text[idx]}"
        )

    viz_df = pd.DataFrame({
        'CONTENT_ID': topic_df['CONTENT_ID'],
        'PARTICIPANT_ID': topic_df['PARTICIPANT_ID'],
        'CONTENT_TYPE': topic_df['CONTENT_TYPE'],
        'DEPARTMENTS': topic_df['DEPARTMENTS'].fillna('Unspecified'),
        'ORIGINAL_TEXT': topic_df['ORIGINAL_TEXT'],
        'ORIGINAL_TEXT_WRAPPED': wrapped_text,
        'HOVER_TEXT': hover_text,
        'TOPIC': topics,
        'TOPIC_LABEL': [topic_labels.get(t, 'Outlier') if t != -1 else 'Outlier' for t in topics],
        'TOPIC_DESCRIPTION': [
            topic_descriptions.get(t, "Outliers - ideas that don't fit clearly into any topic")
            if t != -1 else "Outliers - ideas that don't fit clearly into any topic"
            for t in topics
        ]
    })

    if embeddings_2d.size:
        viz_df['UMAP_1'] = embeddings_2d[:, 0]
        viz_df['UMAP_2'] = embeddings_2d[:, 1]
        viz_df['UMAP_1_centered'] = viz_df['UMAP_1'] - viz_df['UMAP_1'].mean()
        viz_df['UMAP_2_centered'] = viz_df['UMAP_2'] - viz_df['UMAP_2'].mean()

    return viz_df


def build_topic_summary(viz_df):
    """Create a summary dataframe describing each discovered topic."""
    if viz_df.empty:
        return pd.DataFrame(columns=['Topic Label', 'Count', 'Topic Description', 'Representative Quotes'])

    summary_rows = []
    non_outlier_mask = viz_df['TOPIC'] != -1
    topics_order = (
        viz_df.loc[non_outlier_mask, 'TOPIC_LABEL']
        .value_counts()
        .sort_values(ascending=False)
        .index
        .tolist()
    )

    for topic_label in topics_order:
        topic_rows = viz_df[viz_df['TOPIC_LABEL'] == topic_label]
        if topic_rows.empty:
            continue

        topic_description = topic_rows['TOPIC_DESCRIPTION'].iloc[0]
        desc_parts = topic_description.split('\n\nRepresentative examples:')
        summary_rows.append({
            'Topic Label': topic_label,
            'Count': len(topic_rows),
            'Topic Description': desc_parts[0],
            'Representative Quotes': desc_parts[1] if len(desc_parts) > 1 else 'No quotes available'
        })

    outlier_rows = viz_df[viz_df['TOPIC_LABEL'] == 'Outlier']
    if not outlier_rows.empty:
        summary_rows.append({
            'Topic Label': 'Outlier',
            'Count': len(outlier_rows),
            'Topic Description': "Ideas that don't fit clearly into any specific topic",
            'Representative Quotes': 'N/A'
        })

    return pd.DataFrame(summary_rows)
