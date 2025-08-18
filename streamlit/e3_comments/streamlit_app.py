# Import python packages
import streamlit as st
from snowflake.snowpark.context import get_active_session
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Set page configuration
st.set_page_config(page_title="E3 - Comment Analysis", layout="wide")

# Get Snowflake session
session = get_active_session()

# Page title and data summary
st.header("E3 - Comment Analysis")
