import snowflake.connector

from jobs.utils.snowflake import snowflake_connection_from_environment


def drop_schemas_with_prefix(
    conn: snowflake.connector.SnowflakeConnection, database: str, prefix: str
) -> None:
    """
    Clean up schemas starting with a given prefix.

    Given a Snowflake connection, a database, and a prefix, drop all schemas
    in the database starting with the prefix.

    This is intended to clean up dev schemas created by dbt.
    """
    r = conn.cursor().execute(
        f"""SHOW TERSE SCHEMAS IN DATABASE "{database}" STARTS WITH '{prefix}'"""
    )
    results = r.fetchall()

    for s in results:
        name = s[1]
        print(f"Dropping {database}.{name}")
        conn.cursor().execute(f'''DROP SCHEMA IF EXISTS "{database}"."{name}"''')


if __name__ == "__main__":
    import sys

    database = sys.argv[1]
    prefix = sys.argv[2]

    conn = snowflake_connection_from_environment()
    drop_schemas_with_prefix(conn, database, prefix)
