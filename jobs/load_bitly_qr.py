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

load_dotenv()

BITLY_API_KEY = os.environ.get("BITLY_API_KEY")
BITLY_GROUP_GUID = os.environ.get("BITLY_GROUP_GUID")
BITLY_API_BASE = "https://api-ssl.bitly.com/v4"
REQUEST_TIMEOUT = int(os.environ.get("BITLY_REQUEST_TIMEOUT", 30))
RETRY_TOTAL = int(os.environ.get("BITLY_RETRY_TOTAL", 5))
RETRY_BACKOFF = float(os.environ.get("BITLY_RETRY_BACKOFF", 1.0))
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
        allowed_methods=frozenset(["HEAD", "GET"]),
        backoff_factor=RETRY_BACKOFF,
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    return session


def request_with_backoff(
    session: requests.Session, method: str, url: str, **kwargs: Any
) -> requests.Response:
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    try:
        logger.debug("Sending %s request to %s", method, url)
        response = session.request(method, url, **kwargs)
        response.raise_for_status()
        return response
    except RequestException:
        logger.exception("Request failed: %s %s", method, url)
        raise


def _bitly_headers() -> dict:
    if not BITLY_API_KEY:
        raise RuntimeError("BITLY_API_KEY environment variable is not set.")
    return {
        "Authorization": f"Bearer {BITLY_API_KEY}",
        "Content-Type": "application/json",
    }


def fetch_qr_codes_for_group(
    session: requests.Session, group_guid: str
) -> list[dict]:
    """
    Page through GET /v4/groups/{group_guid}/qr-codes and return one record
    per QR code. Captures both standalone codes and those tied to bitlinks.

    Response fields per code: qrcode_id, title, qr_code_type, long_urls, bitlink_id,
    is_customized, archived, created_by, created, updated.
    """
    headers = _bitly_headers()
    url = f"{BITLY_API_BASE}/groups/{group_guid}/qr-codes"
    params: dict[str, Any] = {}
    records: list[dict] = []
    page = 0

    while True:
        page += 1
        logger.debug("Fetching QR codes page %d (search_after=%s)", page, params.get("search_after"))
        response = request_with_backoff(session, "GET", url, headers=headers, params=params)
        data = response.json()
        codes = data.get("qr_codes", [])

        for code in codes:
            records.append({
                "qr_code_id": code.get("qrcode_id", ""),
                "title": code.get("title", ""),
                "qr_code_type": code.get("qr_code_type", ""),
                "long_url": code.get("long_urls", [None])[0],
                "bitlink_id": code.get("bitlink_id"),
                "is_customized": code.get("is_customized"),
                "archived": code.get("archived"),
                "created_by": code.get("created_by", ""),
                "created": code.get("created", ""),
                "updated": code.get("updated", ""),
            })

        search_after = data.get("pagination", {}).get("search_after")
        if not search_after:
            break
        params["search_after"] = search_after

    logger.info("fetch_qr_codes_for_group: %d records across %d pages", len(records), page)
    return records


def fetch_scan_metrics(
    session: requests.Session, qr_code_ids: list[str]
) -> list[dict]:
    """
    For each QR code ID call GET /v4/qr-codes/{qrcode_id}/scans/summary
    (unit=month, units=-1 for all-time totals matching the platform UI).
    Returns one record per QR code with the total scan count.
    """
    headers = _bitly_headers()
    records = []

    for qr_code_id in qr_code_ids:
        url = f"{BITLY_API_BASE}/qr-codes/{qr_code_id}/scans/summary"
        params = {"unit": "month", "units": -1}
        logger.debug("Fetching scan metrics for QR code %s", qr_code_id)

        try:
            response = request_with_backoff(session, "GET", url, headers=headers, params=params)
            data = response.json()
            records.append({
                "qr_code_id": qr_code_id,
                "total_scans": data.get("total_scans", 0),
                "unit": data.get("unit"),
                "units": data.get("units"),
                "unit_reference": data.get("unit_reference"),
            })
        except RequestException as e:
            status = (
                e.response.status_code
                if isinstance(e, requests.exceptions.HTTPError) and e.response is not None
                else "unknown"
            )
            logger.error(
                "Failed to fetch scan metrics for QR code %s (HTTP %s), skipping",
                qr_code_id, status,
            )

    if len(records) < len(qr_code_ids):
        logger.error(
            "fetch_scan_metrics: only %d of %d QR codes returned metrics, some scan data may be missing",
            len(records), len(qr_code_ids),
        )
    logger.info("fetch_scan_metrics: %d records", len(records))
    return records


# Load data to Snowflake

def main() -> None:
    logger.info("Starting Bitly QR code load")

    if not BITLY_GROUP_GUID:
        raise RuntimeError("BITLY_GROUP_GUID environment variable is not set.")

    session = create_retry_session()
    snowflake_conn = snowflake_connection_from_environment(schema="BITLY")

    try:
        schema_name = snowflake_conn.schema or "BITLY"
        quoted_schema = f'"{schema_name.upper()}"'
        snowflake_conn.cursor().execute(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")

        name = "QR_CODE_IDS"
        logger.info("Loading %s", name)

        records = fetch_qr_codes_for_group(session, BITLY_GROUP_GUID)

        if not records:
            logger.error(
                "No QR code records returned from group endpoint. Possible API or config issue."
            )
            return

        load_date = pd.Timestamp.today(tz="America/Los_Angeles").date()
        loaded_at = pd.Timestamp.now("UTC")

        df = pd.DataFrame.from_records(records).assign(
            _LOAD_DATE=load_date,
            _LOADED_AT=loaded_at,
        )
        df = df.reset_index(drop=True)
        df.columns = [col.upper() for col in df.columns]

        if table_exists(snowflake_conn, name):
            existing = snowflake_conn.cursor().execute(
                f'SELECT DISTINCT "QR_CODE_ID" FROM "{name}"'
            ).fetchall()
            existing_ids = {row[0] for row in existing}
            df = df[~df["QR_CODE_ID"].isin(existing_ids)]
            if df.empty:
                logger.info("No new QR code records to load for %s", name)
            else:
                write_pandas(
                    snowflake_conn, df, name,
                    auto_create_table=True, overwrite=False, use_logical_type=True,
                )
                logger.info("Finished loading %s: %d rows", name, len(df))
        else:
            write_pandas(
                snowflake_conn, df, name,
                auto_create_table=True, overwrite=False, use_logical_type=True,
            )
            logger.info("Finished loading %s: %d rows", name, len(df))

        # Load scan metrics for every QR code ID into a separate table.
        # Runs for each QR code ID each time, so metrics refresh each run.
        metrics_name = "QR_CODE_SCAN_METRICS"
        logger.info("Loading %s", metrics_name)

        all_qr_ids = [
            row[0] for row in snowflake_conn.cursor().execute(
                f'SELECT DISTINCT "QR_CODE_ID" FROM "{name}"'
            ).fetchall()
        ]

        if not all_qr_ids:
            logger.info("No QR code IDs found in %s, skipping metrics load", name)
        else:
            metrics_records = fetch_scan_metrics(session, all_qr_ids)

            if metrics_records:
                metrics_df = pd.DataFrame.from_records(metrics_records).assign(
                    _LOAD_DATE=load_date,
                    _LOADED_AT=loaded_at,
                )
                metrics_df = metrics_df.reset_index(drop=True)
                metrics_df.columns = [col.upper() for col in metrics_df.columns]

                write_pandas(
                    snowflake_conn, metrics_df, metrics_name,
                    auto_create_table=True, overwrite=False, use_logical_type=True,
                )
                logger.info("Finished loading %s: %d rows", metrics_name, len(metrics_df))

    finally:
        try:
            snowflake_conn.close()
        except Exception:
            logger.warning("Failed to close Snowflake connection cleanly", exc_info=True)


if __name__ == "__main__":
    main()