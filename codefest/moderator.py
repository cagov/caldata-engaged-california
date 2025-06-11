import os
import json
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
    exit()

# --- 2. DEFINE THE MODERATION FUNCTION ---
def moderate_comment(comment_text: str):
    """
    Uses the Claude API to classify a comment into predefined categories.

    Args:
        comment_text: The user-generated comment to moderate.

    Returns:
        A dictionary containing the moderation decision, or None if an error occurs.
    """
    # The system prompt provides clear instructions, categories, and the desired JSON format.
    # This structured approach makes the model's output reliable and easy to parse.
    system_prompt = """
    You are a content moderation AI. Your task is to classify a user-submitted comment into one of the following three categories:
    - OK: The comment is safe, constructive, and can be published immediately.
    - REVIEW: The comment is not overtly harmful but is ambiguous, sarcastic, uses borderline language, or is off-topic. It requires human review.
    - REJECT: The comment is clear spam, contains hate speech, harassment, threats, or other violations of the community guidelines. It should be rejected.

    Analyze the comment provided and respond with ONLY a single, valid JSON object containing two keys:
    1. "category": One of "OK", "REVIEW", or "REJECT".
    2. "reason": A brief, one-sentence explanation for your classification.

    Example Response:
    {"category": "REJECT", "reason": "The comment contains personal insults and hate speech."}
    """

    try:
        # We use Claude 3 Haiku / sonnet as it is the fastest and most cost-effective model,
        # ideal for high-throughput tasks like content moderation.
        message = client.messages.create(
            model="claude-sonnet-4-20250514", #claude-sonnet-4-20250514 #claude-3-haiku-20240307
            max_tokens=150,
            temperature=0.0, # Set to 0.0 for deterministic, consistent output
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"Please moderate the following comment: '{comment_text}'"
                }
            ]
        )

        # The response from the model is in the first content block.
        response_text = message.content[0].text

        # Parse the JSON string from the model's response.
        moderation_result = json.loads(response_text)
        return moderation_result

    except json.JSONDecodeError:
        print(f"\n[Error] Failed to decode JSON from model response for comment: '{comment_text}'")
        print(f"Raw Response: {response_text}")
        return {"category": "REVIEW", "reason": "Failed to parse model output, requires manual review."}
    except Exception as e:
        print(f"\n[Error] An API error occurred: {e}")
        return None


# --- 3. RUN THE PIPELINE ON EXAMPLE COMMENTS ---
if __name__ == "__main__":
    comments_to_moderate = [
        "This is a fantastic article, thank you for sharing!", # Expected: OK
        "I kind of disagree, but you make some good points.", # Expected: OK
        "Yeah, right. I'm sure that's the *real* reason. Unbelievable.", # Expected: REVIEW
        "This is complete garbage. The author has no idea what they're talking about.", # Expected: REVIEW
        "Buy cheap watches now at spam-link.xyz!!! Best prices!", # Expected: REJECT
        "I hate people like you. You should just go away.", # Expected: REJECT
        "This is an invalid json output." # A tricky case to test error handling
    ]

    print("--- Starting Comment Moderation Pipeline ---")

    for i, comment in enumerate(comments_to_moderate):
        print(f"\n{i+1}. Moderating Comment: \"{comment}\"")
        result = moderate_comment(comment)

        if result:
            # Based on the category, you would trigger different actions in a real application,
            # such as writing to a database, flagging content, or calling another service.
            category = result.get('category', 'UNKNOWN')
            reason = result.get('reason', 'No reason provided.')
            print(f"   -> Decision: {category}")
            print(f"   -> Reason: {reason}")

            if category == "OK":
                print("   -> Action: Auto-approve and publish comment.")
            elif category == "REVIEW":
                print("   -> Action: Send to human moderation queue.")
            elif category == "REJECT":
                print("   -> Action: Delete comment and flag user.")
        else:
            print("   -> Action: Could not process comment. Defaulting to human review.")

    print("\n--- Moderation Pipeline Complete ---")
