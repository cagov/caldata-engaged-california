import os
import sys
import json
import csv
from anthropic import Anthropic

# --- 1. SETUP: Initialize the Anthropic Client ---
# The client automatically reads the ANTHROPIC_API_KEY from your environment variables.
# Make sure you have set it up before running the script.
# e.g., export ANTHROPIC_API_KEY="your-api-key-here"
try:
    client = Anthropic()
except Exception as e:
    print(f"Error initializing Anthropic client: {e}")
    print("Please ensure your ANTHROPIC_API_KEY environment variable is set correctly.")
    exit(1)

# --- 2. DEFINE THE MODERATION FUNCTION ---
def moderate_comment(comment_text: str):
    """
    Uses the Claude API to classify a comment into predefined categories.

    Args:
        comment_text: The user-generated comment to moderate.

    Returns:
        A dictionary containing the moderation decision, or None if an error occurs.
    """
    system_prompt = """
    You are a content moderation AI. Your task is to classify a user-submitted comment into one of the following three categories using the comment guidelines provided:
    - OK: The comment is safe, constructive, and can be published immediately.
    - REVIEW: The comment is not overtly harmful but is ambiguous, sarcastic, uses borderline language, or is off-topic. It requires human review.
    - REJECT: The comment is clear spam, contains hate speech, harassment, threats, or other violations of the community guidelines. It should be rejected.

    Comment Guidelines:
        We expect everyone to be respectful and considerate when commenting. Comments should be rejected if they:
        1. Include personal attacks against the public or specific individuals.
        2. Promote or advertise services or products without authorization.
        3. Contain abusive, profane, or vulgar language.
        4. Contain sexual content, overly graphic, disturbing, obscene or offensive material, or material that would otherwise violate the law if published on this site.
        5. Use offensive language that targets specific ethnic, religious, or racial groups.
        6. Include embedding URLs, hyperlinks, or references to external websites, including link shorteners.
        7. Include personal information (full name, Social Security number, phone numbers, addresses, or email addresses).

    Analyze the comment provided and respond with ONLY a single, valid JSON object containing two keys:
    1. "category": One of "OK", "REVIEW", or "REJECT".
    2. "reason": A brief, one-sentence explanation for your classification.

    Example Response:
    {"category": "REJECT", "reason": "The comment contains personal insults and hate speech."}
    """

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=3000,
            temperature=0.0,
            system=system_prompt,
            messages=[
                {"role": "user", "content": f"Please moderate the following comment: '{comment_text}'"}
            ]
        )

        response_text = message.content[0].text
        moderation_result = json.loads(response_text)
        return moderation_result

    except json.JSONDecodeError:
        print(f"\n[Error] Failed to decode JSON for comment: '{comment_text}'")
        print(f"Raw Response: {response_text}")
        return {"category": "REVIEW", "reason": "Failed to parse model output, requires manual review."}
    except Exception as e:
        print(f"\n[Error] An API error occurred: {e}")
        return None

# --- 3. LOAD COMMENTS FROM CSV ---
def load_comments_from_csv(file_path: str):
    """
    Reads comments from a CSV file. Assumes one comment per row, first column.

    Args:
        file_path: Path to the CSV file containing comments.

    Returns:
        A list of comment strings.
    """
    comments = []
    try:
        with open(file_path, newline='', encoding='utf-8') as csvfile:
            reader = csv.reader(csvfile)
            for row in reader:
                if row:
                    comments.append(row[0])
    except FileNotFoundError:
        print(f"Error: CSV file not found at {file_path}")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading CSV file: {e}")
        sys.exit(1)
    return comments

# --- 4. RUN THE PIPELINE ON COMMENTS FROM CSV AND WRITE OUTPUT ---
if __name__ == "__main__":
    # Allow passing the CSV path as a command-line argument, default to 'comments.csv'
    csv_input_path = sys.argv[1] if len(sys.argv) > 1 else 'comments.csv'
    csv_output_path = sys.argv[2] if len(sys.argv) > 2 else 'moderation_results.csv'

    print(f"--- Starting Comment Moderation Pipeline ---")
    comments_to_moderate = load_comments_from_csv(csv_input_path)

    # Prepare output CSV
    try:
        with open(csv_output_path, 'w', newline='', encoding='utf-8') as outfile:
            writer = csv.writer(outfile)
            # Write header
            writer.writerow(['Comment', 'AI suggestion', 'AI reason'])

            # Process each comment
            for i, comment in enumerate(comments_to_moderate, start=1):
                #print(f"\n{i}. Moderating Comment: \"{comment}\"")
                result = moderate_comment(comment)

                if result:
                    category = result.get('category', 'UNKNOWN')
                    reason = result.get('reason', 'No reason provided.')
                    #print(f"   -> AI suggestion: {category}")
                    #print(f"   -> AI reason: {reason}")

                    # Write row to output CSV
                    writer.writerow([comment, category, reason])
                else:
                    print("   -> Action: Could not process comment. Defaulting to human review.")
                    writer.writerow([comment, 'REVIEW', 'API error, defaulted to REVIEW'])

        print(f"\n--- Moderation complete. Results written to {csv_output_path} ---")

    except Exception as e:
        print(f"Error writing results to CSV: {e}")
        sys.exit(1)
