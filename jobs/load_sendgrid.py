import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import pandas as pd
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from requests.exceptions import RequestException
from snowflake.connector.pandas_tools import write_pandas
from urllib3.util.retry import Retry

from jobs.utils.snowflake import snowflake_connection_from_environment, table_exists

load_dotenv()

SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY")
ACTIVITY_API_URL = "https://api.sendgrid.com/v3/messages"
MAX_RESULTS_PER_PAGE = 1000      # SendGrid hard limit
MIN_WINDOW_SECONDS = 60          # smallest time window the recursive subdivision will attempt
TS_FMT = "%Y-%m-%dT%H:%M:%SZ"   # timestamp format for SendGrid
HOURS_BACK = int(os.environ.get("SENDGRID_HOURS_BACK", 8)) #lookback window for fetching messages, in hours.
REQUEST_TIMEOUT = int(os.environ.get("SENDGRID_REQUEST_TIMEOUT", 30))
RETRY_TOTAL = int(os.environ.get("SENDGRID_RETRY_TOTAL", 5))
RETRY_BACKOFF = float(os.environ.get("SENDGRID_RETRY_BACKOFF", 1.0))
RETRY_STATUS_FORCELIST = [429, 500, 502, 503, 504]



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
    except RequestException:
        logger.exception("Request failed: %s %s", method, url)
        raise


def _fetch_window(session: requests.Session, start: datetime, end: datetime, headers: dict) -> list:
    """
    Fetch all messages in the time window. If the result hits the 1000-message
    limit, split the window in half and recurse.
    """
    window_seconds = (end - start).total_seconds()

    query = 'last_event_time BETWEEN TIMESTAMP "{}" AND TIMESTAMP "{}"'.format(
        start.strftime(TS_FMT),
        end.strftime(TS_FMT),
    )

    qs = urlencode({"limit": MAX_RESULTS_PER_PAGE, "query": query}, quote_via=quote)
    url = "{base}?{qs}".format(base=ACTIVITY_API_URL, qs=qs)

    logger.debug("Querying timeframe %s -> %s", start.strftime(TS_FMT), end.strftime(TS_FMT))

    response = request_with_backoff(session, "GET", url, headers=headers)
    messages = response.json().get("messages", [])

    if len(messages) < MAX_RESULTS_PER_PAGE:
        return messages

    if window_seconds <= MIN_WINDOW_SECONDS:
        logger.warning(
            "Hit %d-message limit on a %ds window (%s -> %s). "
            "Cannot subdivide further. Some messages may be missing.",
            MAX_RESULTS_PER_PAGE,
            window_seconds,
            start.strftime(TS_FMT),
            end.strftime(TS_FMT),
        )
        return messages

    # Split the window in half and recurse into each half
    mid = start + (end - start) / 2
    # Offset by 1 second to avoid double-counting messages at the boundary
    mid_end = mid - timedelta(seconds=1)
    logger.info(
        "Window %s -> %s hit %d-message limit -- splitting at %s",
        start.strftime(TS_FMT),
        end.strftime(TS_FMT),
        MAX_RESULTS_PER_PAGE,
        mid.strftime(TS_FMT),
    )
    left = _fetch_window(session, start, mid_end, headers)
    right = _fetch_window(session, mid, end, headers)
    return left + right


def _extract_subjects(messages: list) -> list[dict]:
    """
    Build a list of {msg_id, short_id, subject} records from Activity API message objects.

    Stores both the full message_id and the short prefix (first segment before '.')
    since Fivetran/webhook sg_message_id and the Activity API msg_id can differ in
    how much of the suffix they include.
    """
    records = []
    for msg in messages:
        msg_id = msg.get("msg_id") or msg.get("message_id")
        subject = msg.get("subject", "")
        if not msg_id:
            continue
        short_id = msg_id.split(".")[0]
        records.append({
            "msg_id": msg_id,
            "short_id": short_id if short_id != msg_id else None,
            "subject": subject,
        })
    return records


def fetch_message_subject_records(session: requests.Session, hours_back: int = HOURS_BACK) -> list[dict]:
    """
    Return a list of message subject records for all messages sent in the last
    `hours_back` hours.

    Automatically handles volumes > 1000 by subdividing the time window
    recursively until each sub-window returns fewer than 1000 results.

    Args:
        session: A requests.Session with retry logic.
        hours_back: How far back to look.
    Returns:
        A list of dicts with keys: msg_id, short_id, subject.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours_back)

    logger.info("Fetching SendGrid activity from %s to %s", start.isoformat(), now.isoformat())

    if not SENDGRID_API_KEY:
        raise RuntimeError("SENDGRID_API_KEY environment variable is not set.")

    headers = {
        "Authorization": "Bearer {}".format(SENDGRID_API_KEY),
        "Content-Type": "application/json",
    }

    all_messages = _fetch_window(session, start, now, headers)
    logger.info("Retrieved %d total messages", len(all_messages))
    return _extract_subjects(all_messages)


def safe_serialize_nested_values(df: pd.DataFrame) -> pd.DataFrame:
    """Serialize any nested list or dict values to JSON strings for Snowflake compatibility."""
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].apply(
                lambda x: json.dumps(x, default=str) if isinstance(x, (list, dict)) else x
            )
    return df


def main() -> None:
    logger.info("Starting SendGrid load")
    session = create_retry_session()
    snowflake_conn = snowflake_connection_from_environment(schema="SENDGRID")

    try:
        schema_name = snowflake_conn.schema or "SENDGRID"
        quoted_schema = f'"{schema_name.upper()}"'
        snowflake_conn.cursor().execute(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")

        name = "MESSAGE_SUBJECTS"
        logger.info("Loading %s", name)
        records = fetch_message_subject_records(session, hours_back=HOURS_BACK)

        if not records:
            logger.info("No data returned for %s", name)
            return

        load_date = pd.Timestamp.today(tz="America/Los_Angeles").date()
        loaded_at = pd.Timestamp.now("UTC")

        df = pd.DataFrame.from_records(records).assign(
            _LOAD_DATE=load_date,
            _LOADED_AT=loaded_at,
        )
        df = safe_serialize_nested_values(df)
        df.columns = [col.upper() for col in df.columns]

        if table_exists(snowflake_conn, name):
            existing = snowflake_conn.cursor().execute(
                f'SELECT DISTINCT "MSG_ID" FROM "{name}"'
            ).fetchall()
            existing_ids = {row[0] for row in existing}
            df = df[~df["MSG_ID"].isin(existing_ids)]
            if df.empty:
                logger.info("No new records to load for %s", name)
                return

        write_pandas(
            snowflake_conn,
            df,
            name,
            auto_create_table=True,
            overwrite=False,
            use_logical_type=True,
        )

        logger.info("Finished loading %s: %d rows", name, len(df))
    finally:
        try:
            snowflake_conn.close()
        except Exception:
            logger.warning("Failed to close Snowflake connection cleanly", exc_info=True)


if __name__ == "__main__":
    main()