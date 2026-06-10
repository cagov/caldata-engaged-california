# https://sortitionfoundation.github.io/sortition-algorithms/api-reference/

import pandas as pd
from pathlib import Path
import os
from dotenv import load_dotenv
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas
from jobs.utils.snowflake import snowflake_connection_from_environment
from sortition_algorithms import (
    run_stratification,
    read_in_features,
    read_in_people,
    Settings,
)

load_dotenv()


######## Sortition settings

final_panel_size = 120
allowed_deviation = 0.25  # how much deviation from the target distribution we allow
id_column = "SURVEY_RESPONDENT_ID"
columns_to_keep = []  # additional columns to keep in the output
selection_algorithm = "maximin"  # default is maximin


# SOURCE_SCHEMA = "GOVOCAL"
TARGET_SCHEMA = "AI_ENGAGEMENT"
TARGET_TABLE = "INT_AI_ENGAGEMENT_SORTITION_SELECTIONS"
SNOWFLAKE_DATABASE = "TRANSFORM_ENGCA_DEV"

FEATURES_SQL = f"""
SELECT
    question as category,
    answer as name,
    greatest(round(adjusted_target_pct * {final_panel_size} * (1 - {allowed_deviation}), 0), iff(answer = 'Non-response', 0, 1)) as min,
    round(adjusted_target_pct * {final_panel_size} * (1 + {allowed_deviation}), 0) as max
FROM TRANSFORM_ENGCA_DEV.DBT_CHOLLINGSWORTH_GOVOCAL.INT_GOVOCAL_SORTITION_TARGETS
"""

PEOPLE_SQL = """
select * from TRANSFORM_ENGCA_DEV.DBT_CHOLLINGSWORTH_GOVOCAL.INT_GOVOCAL_SORTITION_CANDIDATES
"""

ALREADY_SELECTED_SQL = """
select * from TRANSFORM_ENGCA_DEV.DBT_CHOLLINGSWORTH_GOVOCAL.INT_GOVOCAL_SORTITION_CANDIDATES
WHERE FALSE
"""


def prepare_sortition_inputs(features_df, people_df, already_selected_df, settings, number_people_wanted):
    features_df = features_df.copy()
    features_df.columns = features_df.columns.str.lower()

    features = read_in_features(
        list(features_df.columns),
        features_df.fillna("").to_dict(orient="records"),
        number_people_wanted,
    )[0]

    people = read_in_people(
        list(people_df.columns),
        people_df.fillna("").to_dict(orient="records"),
        features,
        settings,
    )[0]

    already_selected = None
    if not already_selected_df.empty:
        already_selected = read_in_people(
            list(already_selected_df.columns),
            already_selected_df.fillna("").to_dict(orient="records"),
            features,
            settings,
        )[0]

    return features, people, already_selected


def preflight_snowflake_write(snowflake_conn, sample_df, target_table):
    preflight_table = f"{target_table}_PREFLIGHT"
    cur = snowflake_conn.cursor()
    try:
        cur.execute(f"USE DATABASE {SNOWFLAKE_DATABASE}")
        cur.execute(f"USE SCHEMA {TARGET_SCHEMA}")
        sample = sample_df.head(1).copy()
        sample["selection_timestamp"] = pd.Timestamp.now("UTC")

        write_pandas(
            snowflake_conn,
            sample,
            table_name=preflight_table,
            auto_create_table=True,
            overwrite=True,
            use_logical_type=True,
        )

        cur.execute(f"DROP TABLE IF EXISTS {preflight_table}")
        print("Preflight snowflake write successful.")

    except Exception as exc:
        raise RuntimeError(
            "Snowflake write preflight failed. Confirm schema, permissions, and table access."
        ) from exc
    finally:
        cur.close()


def save_report_content(report_content):
    local_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", ".local")
    )
    os.makedirs(local_dir, exist_ok=True)

    report_path = os.path.join( local_dir, "ai_impact_sortition_report.txt" )

    with open(report_path, "w") as f:
        f.write(report_content)

    print(f"Saved report: {report_path}")


def main():
    source_conn = None
    source_cur = None
    target_conn = None
    target_cur = None

    try:
        source_conn = snowflake_connection_from_environment()
        source_cur = source_conn.cursor()

        features_df = source_cur.execute(FEATURES_SQL).fetch_pandas_all()
        people_df = source_cur.execute(PEOPLE_SQL).fetch_pandas_all()
        already_selected_df = source_cur.execute(ALREADY_SELECTED_SQL).fetch_pandas_all()

        if people_df.empty:
            raise ValueError("Candidate data is empty; cannot run selection.")

        settings = Settings(
            id_column=id_column,
            columns_to_keep=columns_to_keep,
            selection_algorithm=selection_algorithm,
        )

        number_people_wanted = final_panel_size - len(already_selected_df)

        print("Checking snowflake write before sortition...")
        preflight_snowflake_write(source_conn, people_df, TARGET_TABLE)

    finally:
        if source_cur is not None:
            source_cur.close()
        if source_conn is not None:
            source_conn.close()

    features, people, already_selected = prepare_sortition_inputs(
        features_df,
        people_df,
        already_selected_df,
        settings,
        number_people_wanted,
    )

    success, selected_panels, report = run_stratification(
        features=features,
        people=people,
        number_people_wanted=number_people_wanted,
        settings=settings,
        # number_selections = 1,  # note for later - change this to select multiple panels at once
        already_selected=already_selected,
    )

    panels_as_strings = [", ".join(panel) for panel in selected_panels]
    report_content = [report.as_text(), "\n".join(panels_as_strings)]
    save_report_content("\n\n\n".join(report_content))

    if not success:
        print("Selection failed")
        if report.last_error():
            print(str(report.last_error()))
        return

    selected_people = selected_panels[0]
    print(f"Successfully selected {len(selected_people)} people")

    selected_panel_df = people_df.loc[people_df[id_column].isin(selected_people), [id_column]].reset_index(drop=True)
    selected_panel_df["SELECTION_TIMESTAMP"] = pd.Timestamp.now("UTC")

    try:
        target_conn = snowflake_connection_from_environment()
        target_cur = target_conn.cursor()

        target_cur.execute(f"USE DATABASE {SNOWFLAKE_DATABASE}")
        target_cur.execute(f"USE SCHEMA {TARGET_SCHEMA}")
        write_pandas(
            target_conn,
            selected_panel_df,
            table_name=TARGET_TABLE,
            auto_create_table=True,
            overwrite=False,
            use_logical_type=True,
        )

        print("Job completed successfully.")

    except Exception as exc:
        print(f"Job failed on write back to Snowflake: {exc}")
        raise

    finally:
        if target_cur is not None:
            target_cur.close()
        if target_conn is not None:
            target_conn.close()


if __name__ == "__main__":
    main()
