#!/usr/bin/env python3
"""
translate.py - Translation module for Cantonese job listings to English.
Used by another program: the calling program supplies the DeepSeek API token.
"""

import csv
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# ----------------------------------------------------------------------
# File paths and configuration
# ----------------------------------------------------------------------
LISTINGS_DIR = Path(__file__).parent / "listings"
CANTO_CSV = LISTINGS_DIR / "canto_jobs.csv"
ENG_CSV = LISTINGS_DIR / "english_jobs.csv"

# DeepSeek API settings
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
TEMPERATURE = 0.1
MAX_TOKENS = 2000
SLEEP_BETWEEN_CALLS = 0.5  # seconds, be gentle to the API


# ----------------------------------------------------------------------
# Helper functions
# ----------------------------------------------------------------------
def count_csv_rows(csv_path: Path) -> int:
    """Return the number of data rows (excluding header) in a CSV file."""
    if not csv_path.exists():
        return 0
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header
        return sum(1 for _ in reader)


def read_canto_csv() -> list[dict]:
    """Read canto_jobs.csv and return a list of row dictionaries."""
    with open(CANTO_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def translate_text(text: str, token: str) -> str:
    """
    Call DeepSeek API to translate Cantonese text to English.
    Returns the translated text, or original text on error.
    """
    if not text or not text.strip():
        return text

    prompt = (
        "Translate the following Cantonese text into English. "
        "Provide only the English translation without any additional commentary:\n\n"
        f"{text}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "stream": False,
    }

    try:
        response = requests.post(DEEPSEEK_API_URL, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()
        translation = result["choices"][0]["message"]["content"].strip()
        return translation
    except Exception as e:
        print(f"Translation error: {e}", file=sys.stderr)
        return text  # fallback to original


def translate_row(row: dict, token: str, date_translated: str) -> dict:
    """
    Translate one Cantonese job row to English format.
    Returns a dictionary with columns matching english_jobs.csv.
    """
    # Translate the three designated fields
    title_en = translate_text(row["job_title_original"], token)
    time.sleep(SLEEP_BETWEEN_CALLS)

    desc_en = translate_text(row["raw_description_chinese"], token)
    time.sleep(SLEEP_BETWEEN_CALLS)

    langs_en = translate_text(row["languages_required"], token)
    time.sleep(SLEEP_BETWEEN_CALLS)

    # Build the English row, preserving other fields and adding translation date
    english_row = {
        "job_id": row["job_id"],
        "job_title_english": title_en,
        "company": row["company"],
        "url": row["url"],
        "translated_description_english": desc_en,
        "languages_required_english": langs_en,
        "badge": row["badge"],
        "date_translated": date_translated,
    }
    return english_row


def write_english_csv(rows: list[dict]):
    """Write the translated rows to english_jobs.csv."""
    fieldnames = [
        "job_id",
        "job_title_english",
        "company",
        "url",
        "translated_description_english",
        "languages_required_english",
        "badge",
        "date_translated",
    ]
    with open(ENG_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ----------------------------------------------------------------------
# Main function to be called externally
# ----------------------------------------------------------------------
def translate(token: str) -> None:
    """
    Check row counts of Cantonese and English CSV files.
    If they differ, translate all Cantonese rows to English and overwrite
    english_jobs.csv.

    Args:
        token: DeepSeek API token string.
    """
    # Count rows
    canto_count = count_csv_rows(CANTO_CSV)
    english_count = count_csv_rows(ENG_CSV)

    print(f"Cantonese listings: {canto_count}")
    print(f"English listings:   {english_count}")

    if canto_count == english_count:
        print("Row counts match. No translation needed.")
        return

    print("Mismatch detected. Starting translation...")

    # Read Cantonese data
    canto_rows = read_canto_csv()
    if not canto_rows:
        print("No data in canto_jobs.csv. Nothing to translate.")
        return

    # Current date for the translated rows
    today = datetime.now().strftime("%Y-%m-%d")

    # Translate row by row
    english_rows = []
    for i, row in enumerate(canto_rows, 1):
        print(f"Translating row {i}/{canto_count} (job_id: {row['job_id']})...")
        english_row = translate_row(row, token, today)
        english_rows.append(english_row)

    # Write output
    write_english_csv(english_rows)
    print(f"Translation complete. Written to {ENG_CSV}")


# ----------------------------------------------------------------------
# Optional direct execution for testing (requires token in environment)
# ----------------------------------------------------------------------
if __name__ == "__main__":
    # If you want to test the script standalone, you can still load token from .env
    # But the primary usage is via import and calling translate(token).
    from dotenv import load_dotenv
    import os

    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        token = os.getenv("token")
        if token:
            translate(token)
        else:
            print("No 'token' found in .env file. Exiting.")
    else:
        print("No .env file found. This script is meant to be imported and called with a token.")