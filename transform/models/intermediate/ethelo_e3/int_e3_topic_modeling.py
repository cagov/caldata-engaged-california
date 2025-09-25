"""
dbt Python model for topic modeling of E3 content using UMAP and HDBSCAN.

This script is designed to process and cluster textual content from California state employees,
using advanced machine learning techniques to identify distinct topics or themes. The workflow
includes the following steps:

1. **Embedding Extraction**: Loads precomputed embeddings for supported content types from Snowflake.
2. **Dimensionality Reduction**: Applies UMAP to reduce the high-dimensional embedding space into a smaller,
   more manageable manifold while preserving the structure of the data.
3. **Clustering**: Uses HDBSCAN to group the reduced embeddings into density-based clusters, identifying
   coherent topics while filtering out noise.
4. **Visualization Preparation**: Projects the clustered data into a 2D space for downstream visualization
   and analysis.
5. **Output Generation**: Prepares a structured output containing topic assignments, probabilities,
   and metadata for each content item.

The model ensures reproducibility by seeding all randomness, making the topic IDs stable across runs.
It is optimized for integration into a scheduled pipeline and supports multiple content types,
including "Raw Main Idea" and "Processed Problem & Solution."
"""

from __future__ import annotations

import json
import random
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from hdbscan import HDBSCAN
from sklearn.preprocessing import StandardScaler
from snowflake.snowpark import DataFrame, Session
from snowflake.snowpark.functions import col, trim
from snowflake.snowpark.types import (
    BooleanType,
    DoubleType,
    IntegerType,
    StringType,
    StructField,
    StructType,
)
from umap import UMAP

# All randomness is seeded so clustered topic IDs stay stable between runs and release cycles.
GLOBAL_RANDOM_STATE = 42

# UMAP translates the 1024-d embedding space into a smaller manifold that HDBSCAN can cluster.
#   - n_neighbors manages the trade-off between local detail (smaller values) and global structure (larger values).
#   - n_components is the dimensionality of the reduced space sent to HDBSCAN.
#   - min_dist controls how tightly UMAP packs points together; smaller values preserve cluster density.
# HDBSCAN collapses the reduced points into density-based clusters.
#   - min_cluster_size is the minimum number of documents that should form a cluster.
#   - min_samples governs how aggressively noise is removed; smaller values accept denser clusters while larger values
#     require stronger evidence that a point truly belongs to a cluster.
DEFAULT_CLUSTER_PARAMS = {
    "umap_n_neighbors": 15,
    "umap_n_components": 5,
    "umap_min_dist": 0.0,
    "hdbscan_min_cluster_size": 5,
    "hdbscan_min_samples": 3,
}

# Topic modeling currently runs for two different content sources.
SUPPORTED_CONTENT_TYPES = [
    "Raw Main Idea",
    "Processed Problem & Solution",
]


def _load_embeddings(embeddings_table: DataFrame, content_type: str) -> pd.DataFrame:
    """Fetch embeddings and metadata for a specific content type from the provided table.

    Parameters
    ----------
    embeddings_table: snowflake.snowpark.DataFrame
        Snowflake relation returned by `dbt.ref` containing the unified embeddings.
    content_type: str
        The content type filter to apply (e.g. "Raw Main Idea").

    Returns
    -------
    pandas.DataFrame
        A DataFrame ready for `_to_embedding_matrix` and clustering.
    """

    return (
        embeddings_table
        .filter(col("CONTENT_TYPE") == content_type)
        .filter(col("ORIGINAL_TEXT").is_not_null())
        .filter(trim(col("ORIGINAL_TEXT")) != "")
        .select("CONTENT_ID", "PARTICIPANT_ID", "ORIGINAL_TEXT", "EMBEDDING_VECTOR")
        .order_by("CONTENT_ID")
        .to_pandas()
    )


def _to_embedding_matrix(values: List[Any]) -> np.ndarray:
    """Convert Snowflake embedding values to a 2D NumPy array.

    The Snowflake `EMBEDDING_VECTOR` column can contain different representations:
    - a NumPy array (already deserialized),
    - a Python list of floats,
    - or a JSON string representation of the vector.

    This function normalizes those variants and returns a stacked NumPy array of
    shape (n_samples, embedding_dim) suitable for UMAP and HDBSCAN.

    Parameters
    ----------
    values: list
        A list of embedding values from the DataFrame (mixed types allowed).

    Returns
    -------
    numpy.ndarray
        2D array with one embedding per row.
    """

    vectors: List[np.ndarray] = []
    for value in values:
        if isinstance(value, np.ndarray):
            vectors.append(value)
        elif isinstance(value, list):
            vectors.append(np.array(value))
        else:  # fall back to JSON string representation
            vectors.append(np.array(json.loads(value)))
    return np.stack(vectors)


def _cluster_content(embeddings: np.ndarray) -> Tuple[np.ndarray, Optional[np.ndarray], np.ndarray, np.ndarray]:
    """Run a two-stage embedding clustering pipeline: UMAP then HDBSCAN.

    Steps performed:
    1. Reduce dimensionality of `embeddings` with UMAP using the defaults in
       `DEFAULT_CLUSTER_PARAMS` to produce a reduced representation for clustering.
    2. Cluster the reduced vectors with HDBSCAN to obtain cluster assignments
       and (optionally) membership probabilities.
    3. Produce a separate 2D UMAP projection (and standard-scale it) for visualization.

    Notes
    -----
    - Assignments are integers; outliers are labeled `-1` by HDBSCAN.
    - `probabilities` may be `None` if HDBSCAN doesn't expose them for the fitted model.
    - The function seeds randomness with `GLOBAL_RANDOM_STATE` via UMAP instantiation to
      keep results reproducible.

    Parameters
    ----------
    embeddings: numpy.ndarray
        2D array of shape (n_samples, embedding_dim).

    Returns
    -------
    assignments: numpy.ndarray (int)
        Cluster labels for each sample (-1 indicates outlier).
    probabilities: Optional[numpy.ndarray]
        Membership probabilities for each sample, or None.
    reduced: numpy.ndarray
        The UMAP-reduced vectors used by HDBSCAN.
    projection: numpy.ndarray
        2D projection coordinates (standard-scaled) suitable for plotting.
    """

    umap_model = UMAP(
        n_neighbors=DEFAULT_CLUSTER_PARAMS["umap_n_neighbors"],
        n_components=DEFAULT_CLUSTER_PARAMS["umap_n_components"],
        min_dist=DEFAULT_CLUSTER_PARAMS["umap_min_dist"],
        metric="cosine",
        random_state=GLOBAL_RANDOM_STATE,
    )
    reduced = umap_model.fit_transform(embeddings)

    hdbscan_model = HDBSCAN(
        min_cluster_size=DEFAULT_CLUSTER_PARAMS["hdbscan_min_cluster_size"],
        min_samples=DEFAULT_CLUSTER_PARAMS["hdbscan_min_samples"],
        cluster_selection_method="eom",
        prediction_data=True,
    )
    assignments = hdbscan_model.fit_predict(reduced).astype(int)
    probabilities = getattr(hdbscan_model, "probabilities_", None)

    umap_2d = UMAP(
        n_neighbors=15,
        n_components=2,
        min_dist=0.1,
        target_weight=0.5,
        random_state=GLOBAL_RANDOM_STATE,
    )
    projection = umap_2d.fit_transform(reduced, y=np.array(assignments, dtype=int))
    projection = StandardScaler().fit_transform(projection)

    return assignments, probabilities, reduced, projection


def model(dbt, session: Session):
    """Main dbt entrypoint: cluster supported content types and emit per-content records.

    This function orchestrates the full topic modeling pipeline for each content type
    listed in `SUPPORTED_CONTENT_TYPES`. High-level responsibilities:

    - Configure dbt materialization and required Python packages.
    - Optionally switch the Snowflake `session` to the dbt `this` database/schema.
    - Seed the Python and NumPy RNGs for reproducibility.
    - For each supported content type:
      * Load embeddings and metadata via `_load_embeddings`.
      * Convert embeddings to a NumPy matrix via `_to_embedding_matrix`.
      * Run `_cluster_content` to get cluster assignments, probabilities, and projections.
      * Normalize probability values, handle outliers, and create stable topic IDs of the form
        "<content-index>-<topic-number>".
      * Emit one record per input item containing content and clustering metadata for
        downstream labeling, visualization, and reporting.

    The final output is a Snowflake dataframe with schema:
      content_type, topic_id, content_id, participant_id, original_text,
      topic_probability, is_outlier, umap_x, umap_y

    Returns
    -------
    snowflake.snowpark.DataFrame
        A DataFrame materialized by dbt (via session.create_dataframe) containing one row
        per original content item and its associated topic metadata.
    """

    dbt.config(
        materialized="table",
        packages=["hdbscan", "numpy", "pandas", "scikit-learn", "umap-learn"],
    )

    if dbt.this.database:
        session.use_database(dbt.this.database)
    if dbt.this.schema:
        session.use_schema(dbt.this.schema)

    random.seed(GLOBAL_RANDOM_STATE)
    np.random.seed(GLOBAL_RANDOM_STATE)

    output_columns = [
        "content_type",
        "topic_id",
        "content_id",
        "participant_id",
        "original_text",
        "topic_probability",
        "is_outlier",
        "umap_x",
        "umap_y",
    ]
    data_rows: List[Tuple[Any, ...]] = []

    # Resolve the embeddings table via dbt.ref for portability.
    embeddings_table = dbt.ref("e3_embeddings_unified")

    # Top-level loop: process each supported content type separately.
    # For each content type we load embeddings, convert them to a NumPy matrix,
    # run UMAP + HDBSCAN to find topics, normalize probabilities, map stable topic IDs,
    # and emit one record per original content item for downstream use.
    for content_index, content_type in enumerate(SUPPORTED_CONTENT_TYPES, start=1):

        # Step 1: Load embeddings and metadata for this content type from Snowflake
        df = _load_embeddings(embeddings_table, content_type)
        # If there's no data for this content type, skip it
        if df.empty:
            continue

        # Step 2: Convert the Snowflake embedding column into a NumPy matrix
        # This is the matrix we'll feed into UMAP and HDBSCAN
        embeddings = _to_embedding_matrix(df["EMBEDDING_VECTOR"].tolist())

        # Step 3: Run dimensionality reduction + clustering
        # returns: assignments (cluster labels), probabilities (membership confidences),
        # reduced (UMAP-reduced vectors used for clustering), projection (2D coords for viz)
        assignments, probabilities, _reduced, projection = _cluster_content(embeddings)

        # Step 4: Normalize/prepare topic probability values for downstream storage
        # HDBSCAN may not provide probabilities for all models; and outliers are labeled -1
        topic_probabilities: List[Optional[float]] = []
        if probabilities is None:
            # If HDBSCAN didn't produce probabilities, preserve None so downstream logic can handle it
            topic_probabilities = [None] * len(assignments)
        else:
            # Convert NaNs and outlier labels into None, otherwise cast to float
            for idx, label in enumerate(assignments):
                if label == -1:
                    topic_probabilities.append(None)
                else:
                    value = float(probabilities[idx])
                    topic_probabilities.append(value if not np.isnan(value) else None)

        # Step 5: Create stable, human-readable topic IDs
        # We map local cluster integers (e.g. 0,1,2) to strings like "<content-index>-<topic-number>"
        # Outliers (-1) will not be included in the mapping and will result in a None topic_id
        non_outliers = sorted([t for t in np.unique(assignments) if t != -1])
        local_to_global: Dict[int, Optional[str]] = {
            local_topic: f"{content_index}-{pos}"
            for pos, local_topic in enumerate(non_outliers, start=1)
        }

        # Step 6: Emit one record per original content item with clustering metadata
        # We keep the original text and participant id so downstream labeling can inspect examples
        for idx, content_id in enumerate(df["CONTENT_ID"].astype(int).tolist()):
            local_topic = int(assignments[idx])
            global_topic_id = local_to_global.get(local_topic)

            record = {
                "content_type": content_type,
                "topic_id": global_topic_id,
                "content_id": content_id,
                "participant_id": str(df["PARTICIPANT_ID"].iloc[idx]) if df["PARTICIPANT_ID"].iloc[idx] is not None else None,
                "original_text": df["ORIGINAL_TEXT"].iloc[idx],
                "topic_probability": topic_probabilities[idx],
                "is_outlier": local_topic == -1,
                "umap_x": float(projection[idx][0]) if projection.size else None,
                "umap_y": float(projection[idx][1]) if projection.size else None,
            }

            # Step 7: Append a tuple in the same column order as `output_columns` for DataFrame creation
            data_rows.append(tuple(record.get(col) for col in output_columns))

    # Schema definition for the output dataframe
    schema = StructType(
        [
            StructField("content_type", StringType()),
            StructField("topic_id", StringType()),
            StructField("content_id", IntegerType()),
            StructField("participant_id", StringType()),
            StructField("original_text", StringType()),
            StructField("topic_probability", DoubleType()),
            StructField("is_outlier", BooleanType()),
            StructField("umap_x", DoubleType()),
            StructField("umap_y", DoubleType()),
        ]
    )

    if not data_rows:
        return session.create_dataframe([], schema=schema)

    # Return the final dataframe to dbt
    return session.create_dataframe(data_rows, schema=schema)
