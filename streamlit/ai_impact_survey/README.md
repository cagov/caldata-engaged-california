# Overview

This repository represents work by the CalData team within CA ODI related to the deliberative democratic project known as EngagedCA. The project involves reaching out to residents of California and asking them to share their thoughts and concerns about AI and how it may impact their lives.

The purpose of this repository is to develop a Streamlit app that will run inside ODI's Snowflake environment and use Snowflake's built-in AI features to enable ODI stakeholders to explore and understand the semi-structured text responses gathered from survey respondents.

# Repository Structure

`/examples`: contains Streamlit dashboards created for prior EngagedCA projects
`/notebooks`: exploratory notebooks, useful for getting a sense of the data schema

# Phase 1 Objectives and Wishlist

- Create version 1 of a Streamlit dashboard that tees up the open-ended survey responses for LLM analysis
  - You can start by pointing it at this table: TRANSFORM_ENGCA_PRD.GOVOCAL.INT_GOVOCAL_AI_SURVEY 
  - Streamlit dash should be pre-loaded with a few prompts (work with Summer to define the goals of these prompts)— so you can push a button and it runs the prompt 
  - it should enable you to analyze all responses to all questions at once, or select which question(s) you want to prompt
  - it should have filters so you can view questions submitted by the demographic categories. See the LA Fires dashboard for an example of what that can look like

- This is a high level wishlist from our stakeholder of what they might want to analyze (they are quite general, we do not need to meet all of them):
  - any pattern or trend
  - broadly speaking, to be able to say. what is the sentiment. here’s what they’re worried about.
  - what’s the balance — where are people saying they’re excited vs. reticent
  - being able to report some level of detail on what ppl are thinking
  - they’re going to want specific ideas for what the policy ideas are
  - top 5 policy ideas
