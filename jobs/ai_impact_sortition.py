# https://sortitionfoundation.github.io/sortition-algorithms/api-reference/
# this could probably be genericized if we decide to do sortition for other projects after AI Impact

import pandas as pd
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas
from jobs.utils.snowflake import snowflake_connection_from_environment
from sortition_algorithms import (
    run_stratification,
    read_in_features,
    read_in_people,
    Settings,
)


# Sortition settings ---------------------------------------------
final_panel_size = 120
id_column = "user_id"
columns_to_keep = []  # additional columns to keep in the output
selection_algorithm = "maximin"  # default is maximin

settings = Settings(
    id_column=id_column,
    columns_to_keep=columns_to_keep,
    selection_algorithm=selection_algorithm,
)


# Get data ------------------------------------------------------
snowflake_conn = snowflake_connection_from_environment(schema="GOVOCAL")

features_sql = """
SELECT *
FROM ANALYTICS.SORTITION.DEMOGRAPHIC_FEATURES
"""

people_sql = """
SELECT *
FROM ANALYTICS.SORTITION.CANDIDATES
WHERE eligible = TRUE
"""

already_selected_sql = """
SELECT *
FROM ANALYTICS.SORTITION.ALREADY_SELECTED
WHERE selection_cycle = '2026_Q2'
"""

features_df = snowflake_conn.cursor().execute(features_sql).fetch_pandas_all()
people_df = snowflake_conn.cursor().execute(people_sql).fetch_pandas_all()
already_selected_df = snowflake_conn.cursor().execute(already_selected_sql).fetch_pandas_all()


# Set Up Sortition

number_people_wanted = final_panel_size - len(already_selected_df)

features = read_in_features(features_df)
people = read_in_people(people_df, settings, features)
already_selected = None
if not already_selected_df.empty:
    already_selected = read_in_people(already_selected_df, settings, features)


# Run Sortition

success, selected_panels, report = run_stratification(
    features=features,
    people=people,
    number_people_wanted=number_people_wanted,
    settings=settings,
    already_selected=already_selected,
)


# Write back to Snowflake

if success:

    selected_people = selected_panels[0]

    print(f"Successfully selected {len(selected_people)} people")

    selected_panel_df = people_df[people_df[id_column].isin(selected_people)].copy()
    selected_panel_df["selection_timestamp"] = pd.Timestamp.now("UTC")

    snowflake_conn.cursor().execute("USE SCHEMA AI_IMPACT")

    write_pandas(
        snowflake_conn,
        selected_panel_df,
        table_name="SELECTED_PANEL",
        auto_create_table=True,
        overwrite=False,
        use_logical_type=True,
    )

else:
    print("Selection failed")

    if report.last_error():
        print(str(report.last_error()))

print(report.as_text())
snowflake_conn.close()
