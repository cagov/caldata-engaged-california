
"""
Load Data to Coda
==============================

This script writes to table in Coda using the Coda API. 
It creates synthetic data first, just for demonstration purposes.

Requirements:
    - Python 3.7+
    - Packages: `pandas`, `requests`, `faker`
    - A Coda API token (see instructions below)

Environment Variables:
    CODA_API_TOKEN: Your personal Coda API token.
    CODA_DOC_ID: The ID of the Coda document you want to write to.
    CODA_TABLE_ID: The ID of the table within the Coda document.

Instructions to Get Your Coda API Token:
    1. Visit https://coda.io/account
    2. Scroll to “API tokens”
    3. Click “+ Generate API token”
    4. Name and create your token
    5. Copy it and store securely (you won't see it again)
    6. Set it as an environment variable or save it in a .env file:
       export CODA_API_TOKEN=your_token_here

How to Find doc_id and table_id:
    - doc_id:
        (ask the author of this script, or do this:)
        1. Open your Coda doc
        2. The URL will look like: https://coda.io/d/My-Doc_dABC123xyz/_suXYz
        3. The doc_id is the part after `d/` and before the first `_` (e.g. `ABC123xyz`)
        (Or just ask the author of this script)
    
    - table_id:
        (ask the author of this script, or do this:)
        1. Go to https://coda.io/developers/apis/v1#operation/listTables
        2. Authorize with your token
        3. Input your doc_id and hit "Try it"
        4. Find the `id` value in the response for the table you're targeting

Output:
    - Prints success/failure for each inserted row to the console.

===========================
"""

import os
import pandas as pd
import requests
from faker import Faker   # you won't need this library when we use real data

import random


# --- Configuration ---
api_token = os.getenv("CODA_API_TOKEN")
doc_id = os.getenv("CODA_DOC_ID")
table_id = os.getenv("CODA_TABLE_ID")

##-----------

fake = Faker()

# --- Generate Fake Data with Extra Empty Columns ---
# This is just making fake data to demo. Can be removed for production.
df = pd.DataFrame([{
    'Comment ID': fake.uuid4(),
    'Topic': fake.sentence(nb_words=6),
    'Type': random.choice(['Comment', 'Question', 'Feedback']),
    'Target': fake.word(),
    'Posted By': fake.name(),
    'Posted By Id': fake.uuid4(),
    'Privacy': random.choice(['Public', 'Private']),
    'Content': fake.paragraph(nb_sentences=2),
    'Reply To Id': fake.uuid4(),
    'Posted On': fake.iso8601(),
    'Reply Count': random.randint(0, 5),
    'Flag Count': random.randint(0, 3),
    'Like Count': random.randint(0, 10),
    'AI SUGGESTION': '',  # Empty column
    'AI REASON': ''       # Empty column
} for _ in range(5)])

# --- Coda API Setup ---
url = f'https://coda.io/apis/v1/docs/{doc_id}/tables/{table_id}/rows'
headers = {
    'Authorization': f'Bearer {api_token}',
    'Content-Type': 'application/json'
}

# --- Upload Rows to Coda ---
# This loads data row by row, which mimicks what we will need to do for our AI API calls. 

for _, row in df.iterrows():
    payload = {
        "rows": [
            {
                "cells": [{"column": col, "value": row[col]} for col in df.columns]
            }
        ]
    }
    response = requests.post(url, headers=headers, json=payload)
    if response.status_code != 202:
        print(f"❌ Failed to insert row: {row.to_dict()}")
        print(response.text)
    else:
        print(f"✅ Inserted row: {row.to_dict()}")