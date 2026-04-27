import os
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from snowflake.connector.pandas_tools import write_pandas
from jobs.utils.snowflake import snowflake_connection_from_environment, table_exists

load_dotenv()  # Load environment variables from .env file

# Configuration for Go Vocal API
BASE_URL = "https://engaged-ca.govocal.com/api/v2"
CLIENT_ID = os.environ.get("GO_VOCAL_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GO_VOCAL_CLIENT_SECRET")

history_capture = False   # False for a full refresh for each load, True to accumulate daily snapshots

endpoints = {
    "COMMENTS": "comments",
    "IDEAS": "ideas",
    "REACTIONS": "reactions",
    "PROJECTS": "projects",
    "PHASES": "phases",
    "PROJECT_FOLDERS": "project_folders",
    "TOPICS": "topics",
    "USERS": "users",
    "PROJECT_TOPICS": "project_topics",
    "IDEA_TOPICS": "idea_topics",
    "IDEA_PHASES": "idea_phases",
    "BASKETS": "baskets",
    "BASKET_IDEAS": "basket_ideas",
    "EMAIL_CAMPAIGNS": "email_campaigns",
    "EMAIL_CAMPAIGN_DELIVERIES": "email_campaign_deliveries",
    "EVENTS": "events",
    "EVENT_ATTENDANCES": "event_attendances",
    "VOLUNTEERING_CAUSES": "volunteering_causes",
    "VOLUNTEERING_VOLUNTEERS": "volunteering_volunteers"
}


def get_govocal_token():
    """
    Authenticate with the Go Vocal API and return a JWT token.
    """
    url = f"{BASE_URL}/authenticate"

    response = requests.post(
        url,
        json={
            "auth": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            }
        },
    )
    response.raise_for_status()
    data = response.json()

    if "jwt" not in data:
        raise ValueError(f"Token not found in response: {data}")

    return data["jwt"]


def fetch_all_govocal(endpoint: str, token: str) -> list:
    """
    Retrieve all records from a Go Vocal endpoint using pagination.

    Args:
        endpoint: API endpoint name (e.g., "ideas", "projects")
        token: Bearer token for authentication

    Returns:
        List of records from the endpoint
    """
    headers = {"Authorization": f"Bearer {token}"}

    page = 1
    all_records = []

    while True:
        url = f"{BASE_URL}/{endpoint}?page_number={page}&page_size=24"

        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()

        records = list(data.values())[0]

        if not records:
            break

        all_records.extend(records)
        page += 1

    return all_records


def drop_empty_struct_columns(df):
    """Drops columns that contain only empty dicts, lists, or Nones."""
    cols_to_drop = []

    for col in df.columns:
        if df[col].dtype == 'object':
            # A column is "empty" if every row is either None, {}, or []
            is_empty = df[col].apply(lambda x: x in [None, {}, []] or pd.isna(x)).all()

            if is_empty:
                cols_to_drop.append(col)

    if cols_to_drop:
        print(f"Dropping empty struct columns: {cols_to_drop}")
        return df.drop(columns=cols_to_drop)

    return df


if __name__ == "__main__":

    error_message = ""

# Create Snowflake connection
    snowflake_conn = snowflake_connection_from_environment(
        warehouse = "LOADING_XS_ENGCA_PRD",
        role="RAW_ENGCA_PRD_READWRITECONTROL",
        database='RAW_ENGCA_PRD',
        schema="GOVOCAL"
    )

    snowflake_conn.cursor().execute(f"CREATE SCHEMA IF NOT EXISTS {snowflake_conn.schema.upper()}")

    token = get_govocal_token()

    for name, endpoint in endpoints.items():
        try:
            print(f"Loading {name}")

            records = fetch_all_govocal(endpoint, token)

            if not records:
                print(f"No data returned for {name}")
                continue

            load_date = pd.Timestamp.today(tz="America/Los_Angeles").date()
            loaded_at = pd.Timestamp.now("UTC")

            df = pd.DataFrame.from_records(records).assign(
                _LOAD_DATE=load_date,
                _LOADED_AT=loaded_at,
            )

            df = drop_empty_struct_columns(df)  # Remove empty struct columns, which cause issues with write_pandas

            # df.columns = [col.upper() for col in df.columns]

            if table_exists(snowflake_conn, name) and history_capture:

                snowflake_conn.cursor().execute(
                    f"""
                    DELETE FROM "{name}"
                    WHERE _LOAD_DATE = '{load_date.isoformat()}'
                    """
                )

                write_pandas(
                    snowflake_conn,
                    df,
                    name,
                    auto_create_table=False,
                    overwrite=False,
                    use_logical_type=True,
                )

            else:
                write_pandas(
                    snowflake_conn,
                    df,
                    name,
                    auto_create_table=True,
                    overwrite=True,
                    use_logical_type=True,
                )

            print(f"Finished loading {name}: {len(df)} rows")

        except Exception as e:
            print(f"Unable to load {name}, due to {e}")
            error_message += f"Unable to load {name}, due to {e}\n"

    if error_message:
        raise RuntimeError(error_message)
