import json
import logging
import os
from typing import Any
import pandas as pd
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from requests.exceptions import RequestException
from snowflake.connector.pandas_tools import write_pandas
from urllib3.util.retry import Retry

from jobs.utils.snowflake import snowflake_connection_from_environment, table_exists

load_dotenv()  # Load environment variables from .env file

# Configuration for Go Vocal API
BASE_URL = "https://join.engaged.ca.gov/api/v2"
CLIENT_ID = os.environ.get("GO_VOCAL_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GO_VOCAL_CLIENT_SECRET")
PAGE_SIZE = int(os.environ.get("GO_VOCAL_PAGE_SIZE", 24))  # Go Vocal's max page size is 24.
REQUEST_TIMEOUT = int(os.environ.get("GO_VOCAL_REQUEST_TIMEOUT", 30))  # Request timeout in seconds
RETRY_TOTAL = int(os.environ.get("GO_VOCAL_RETRY_TOTAL", 5))  # Total number of retries
RETRY_BACKOFF = float(os.environ.get("GO_VOCAL_RETRY_BACKOFF", 1.0))
RETRY_STATUS_FORCELIST = [429, 500, 502, 503, 504]  # HTTP status codes to trigger a retry

history_capture = False  # False for a full refresh for each load, True to accumulate daily snapshots

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
    "VOLUNTEERING_VOLUNTEERS": "volunteering_volunteers",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def create_retry_session() -> requests.Session:
    session = requests.Session()
    retry_strategy = Retry(
        total=RETRY_TOTAL,
        status_forcelist=RETRY_STATUS_FORCELIST,
        allowed_methods=frozenset(["HEAD", "GET", "POST"]),
        backoff_factor=RETRY_BACKOFF,
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    return session


def request_with_backoff(session: requests.Session, method: str, url: str, **kwargs: Any) -> requests.Response:
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    try:
        logger.debug("Sending %s request to %s", method, url)
        response = session.request(method, url, **kwargs)
        response.raise_for_status()
        return response
    except RequestException as exc:
        logger.exception("Request failed: %s %s", method, url)
        raise


def get_govocal_token(session: requests.Session) -> str:

    url = f"{BASE_URL}/authenticate"
    response = request_with_backoff(
        session,
        "POST",
        url,
        json={
            "auth": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            }
        },
    )
    data = response.json()

    if "jwt" not in data:
        raise ValueError(f"Token not found in response: {data}")

    return data["jwt"]

#  Retrieve all records for a given endpoint using pagination, with backoff and retry logic.
def fetch_all_govocal(session: requests.Session, endpoint: str, token: str) -> list:
    headers = {"Authorization": f"Bearer {token}"}
    page = 1
    all_records = []

    while True:
        url = f"{BASE_URL}/{endpoint}?page_number={page}&page_size={PAGE_SIZE}"
        response = request_with_backoff(session, "GET", url, headers=headers)
        data = response.json()

        records = list(data.values())[0]

        if not records:
            break

        all_records.extend(records)
        page += 1

    return all_records

# Serialize any nested list or dict values in the DataFrame to JSON strings, so they can be stored in Snowflake without issues.
def safe_serialize_nested_values(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].apply(
                lambda x: json.dumps(x, default=str) if isinstance(x, (list, dict)) else x
            )
    return df


def main() -> None:
    logger.info("Starting Go Vocal load")
    session = create_retry_session()
    snowflake_conn = snowflake_connection_from_environment(schema="GOVOCAL")

    try:
        schema_name = snowflake_conn.schema or "GOVOCAL"
        quoted_schema = f'"{schema_name.upper()}"'
        snowflake_conn.cursor().execute(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")

        token = get_govocal_token(session)
        error_messages = []

        for name, endpoint in endpoints.items():
            try:
                logger.info("Loading %s", name)
                records = fetch_all_govocal(session, endpoint, token)

                if not records:
                    logger.info("No data returned for %s", name)
                    continue

                load_date = pd.Timestamp.today(tz="America/Los_Angeles").date()
                loaded_at = pd.Timestamp.now("UTC")

                df = pd.DataFrame.from_records(records).assign(
                    _LOAD_DATE=load_date,
                    _LOADED_AT=loaded_at,
                )
                df = safe_serialize_nested_values(df)

                if table_exists(snowflake_conn, name) and history_capture:
                    snowflake_conn.cursor().execute(
                        f"DELETE FROM \"{name}\" WHERE _LOAD_DATE = '{load_date.isoformat()}'"
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

                logger.info("Finished loading %s: %d rows", name, len(df))
            except Exception as exc:
                logger.exception("Unable to load %s", name)
                error_messages.append(f"Unable to load {name}, due to {exc}")

        if error_messages:
            raise RuntimeError("\n".join(error_messages))
    finally:
        try:
            snowflake_conn.close()
        except Exception:
            logger.warning("Failed to close Snowflake connection cleanly", exc_info=True)


if __name__ == "__main__":
    main()
