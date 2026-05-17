# https://sortitionfoundation.github.io/sortition-algorithms/api-reference/
# this could probably be genericized if we decide to do sortition for other projects after AI Impact


import pandas as pd
import os
from dotenv import load_dotenv
from tempfile import NamedTemporaryFile
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
id_column = "survey_respondent_id"
columns_to_keep = []  # additional columns to keep in the output
selection_algorithm = "maximin"  # default is maximin


######## Get data

snowflake_conn = snowflake_connection_from_environment(schema="GOVOCAL")
cur = snowflake_conn.cursor()

features_sql = """
SELECT category, name, min, target as max
FROM RAW_ENGCA_PRD.DEMOGRAPHICS.SORTITION_TARGETS
"""

people_sql = """
with

respondents as (select * from ANALYTICS_ENGCA_PRD.GOVOCAL.GOVOCAL_AI_SURVEY_RESPONDENTS),

candidates as (
    select *
    from respondents
    where true
    and availability_for_discussion in ('Yes', 'Maybe')
    and county <> 'I live outside of California'
    and age <> 'Under 18'
    and current_work_status <> 'No, I''m retired or choose not to work'
    and current_work_status is not null
    and current_work_status <> 'I don''t want to say'

    -- until we decide how to handle nulls and non-responses in demographics, these respondents are being removed
    and age is not null
    and gender_category is not null
    and race_ethnicity_category is not null
    and county is not null
    and role_at_work is not null
    and field_of_work is not null
    and age <> 'I don''t want to say'
    and gender_category <> 'I don''t want to say (only)'
    -- and race_ethnicity_category <> 'I don''t want to say (only)'
    and county <> 'I don''t want to say'
    and role_at_work <> 'I don''t want to say'
    and field_of_work <> 'I don''t want to say'
),

group_categorize as (
    select
        survey_respondent_id,
        age,
        IFF(gender_category IN
            ('Another gender identity (like transgender, non-binary, or gender non-conforming) (only)',
            'Multiple'),
            'Nonbinary / multi / other',
            gender_category) as gender_category,
        race_ethnicity_category,
        region,
        IFF(role_at_work IN
            ('Business owner or entrepreneur', 'Contractor, freelancer, or gig worker'),
            'UNKNOWN',
            role_at_work) as role_at_work,
        CASE field_of_work
            WHEN 'Corporate ownership or governance' THEN 'Corporate'
            WHEN 'Finance' THEN 'Corporate'
            WHEN 'Information technology' THEN 'Corporate'
            WHEN 'Legal' THEN 'Corporate'
            WHEN 'Retail or wholesale trade' THEN 'Logistics & retail'
            WHEN 'Transportation or warehousing' THEN 'Logistics & retail'
            WHEN 'Healthcare' THEN 'Healthcare'
            WHEN 'Government' THEN 'Public sector'
            WHEN 'Non-profit' THEN 'Public sector'
            WHEN 'Education' THEN 'Education'
            WHEN 'Arts, entertainment, or media' THEN 'Creative'
            else 'UNKNOWN' end as field_of_work
    from candidates
)

select *
from group_categorize
-- NEEDS ATTENTION!!! ----------------------------------
where role_at_work <> 'UNKNOWN' and field_of_work <> 'UNKNOWN'
"""

already_selected_sql = """
SELECT survey_respondent_id, age, gender_category, race_ethnicity_category, county, role_at_work, field_of_work
FROM ANALYTICS_ENGCA_PRD.GOVOCAL.GOVOCAL_AI_SURVEY_RESPONDENTS
WHERE FALSE
"""

features_df = cur.execute(features_sql).fetch_pandas_all()
people_df = cur.execute(people_sql).fetch_pandas_all()
already_selected_df = cur.execute(already_selected_sql).fetch_pandas_all()


######## Set Up Sortition

settings = Settings(
    id_column=id_column,
    columns_to_keep=columns_to_keep,
    selection_algorithm=selection_algorithm,
)

number_people_wanted = final_panel_size - len(already_selected_df)

features_df.columns = features_df.columns.str.lower()
features_head = list(features_df.columns)
features_body = (
    features_df
    .fillna("")
    .to_dict(orient="records")
)
features = read_in_features(
    features_head,
    features_body,
    number_people_wanted,
)[0]

people_head = list(people_df.columns)
people_body = (
    people_df
    .fillna("")
    .to_dict(orient="records")
)
print(type(features))
people = read_in_people(
    people_head,
    people_body,
    features,
    settings,
)[0]

already_selected = None
if not already_selected_df.empty:
    already_selected_head = list(already_selected_df.columns)
    already_selected_body = (
        already_selected_df
        .fillna("")
        .to_dict(orient="records")
    )
    already_selected = read_in_people(
        already_selected_head,
        already_selected_body,
        features,
        settings,
    )[0]


######## Run Sortition

success, selected_panels, report = run_stratification(
    features=features,
    people=people,
    number_people_wanted=number_people_wanted,
    settings=settings,
    already_selected=already_selected,
)


######## Write back to Snowflake

if success:

    selected_people = selected_panels[0]

    print(f"Successfully selected {len(selected_people)} people")

    selected_panel_df = people_df[people_df[id_column].isin(selected_people)].copy()
    selected_panel_df["selection_timestamp"] = pd.Timestamp.now("UTC")

    cur.execute("USE SCHEMA AI_IMPACT")

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
