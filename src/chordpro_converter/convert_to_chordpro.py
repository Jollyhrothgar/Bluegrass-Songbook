# src/chordpro_converter/convert_to_chordpro.py
# -*- coding: utf-8 -*-
# File last modified correcting DEFAULT_SOURCE_DIR: Sunday, April 6, 2025 at 5:00:00 PM PDT

import os
import sys
import logging
import argparse
import time
import json
import re # Needed for sanitize_filename
from pathlib import Path
from multiprocessing import Pool, cpu_count
from functools import partial

# Ensure parser_utils can be imported using relative import
try:
    from .parser_utils import extract_chordpro_fields_from_html, parse_body_to_chordpro
except ImportError:
    # Fallback for running script directly in src/chordpro_converter
    try:
         from parser_utils import extract_chordpro_fields_from_html, parse_body_to_chordpro
    except ImportError:
          print("Error: Could not import parser functions. Make sure parser_utils.py is accessible.")
          sys.exit(1)


# --- Constants ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent # Get project root reliably
# *** CORRECTED DEFAULT SOURCE DIRECTORY ***
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "sources" / "www.classic-country-song-lyrics.com"
DEFAULT_OUTPUT_PRO_DIR = PROJECT_ROOT / "output_pro" # Default output dir for .pro files
LOG_FILE = PROJECT_ROOT / "parsing_log.log"
ERROR_LOG_FILE = PROJECT_ROOT / "parsing_errors.log"

# --- Logging Setup ---
# (Keep the existing setup_logging function - no changes needed)
def setup_logging():
    """Configures logging for console, main log file, and error log file."""
    log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    error_formatter = logging.Formatter('%(asctime)s - %(levelname)s - [%(module)s:%(lineno)d] - FILE: %(filepath)s - ERROR: %(message)s')

    script_logger = logging.getLogger('ChordproConverterScript')
    script_logger.setLevel(logging.INFO)
    if not script_logger.hasHandlers():
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(log_formatter)
        script_logger.addHandler(console_handler)
        file_handler = logging.FileHandler(LOG_FILE, mode='w')
        file_handler.setFormatter(log_formatter)
        script_logger.addHandler(file_handler)

    error_logger = logging.getLogger('ParseErrors')
    error_logger.setLevel(logging.ERROR)
    if not error_logger.hasHandlers():
        error_file_handler = logging.FileHandler(ERROR_LOG_FILE, mode='w')
        error_file_handler.setFormatter(error_formatter)
        error_logger.addHandler(error_file_handler)
        error_logger.propagate = False

    return script_logger, error_logger

logger, error_logger = setup_logging()

# --- Filename Sanitization ---
# (No changes needed in this function)
def sanitize_filename(name):
    """Removes or replaces characters invalid for filenames."""
    if not name:
        return "unknown"
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name)
    sanitized = re.sub(r'\s+', '_', sanitized)
    return sanitized[:100] # Limit length

# --- File Processing Function (for Workers) ---
# (No changes needed in this function)
def process_file(filepath, base_dir):
    """
    Reads HTML, extracts metadata, parses body, returns structured results.
    """
    filepath = Path(filepath)
    base_dir = Path(base_dir)
    try:
        relative_path = filepath.relative_to(base_dir.parent) # Relative to 'sources'
    except ValueError:
         relative_path = filepath.name

    logger.debug(f"Processing: {relative_path}")
    result_dict = {
        'filepath': str(filepath),
        'relative_path': str(relative_path),
        'status': 'error',
        'data': None,
        'error_message': 'Unknown error'
    }
    try:
        try:
            with open(filepath, 'r', encoding='utf-8') as f: html_content = f.read()
        except UnicodeDecodeError:
            logger.warning(f"UTF-8 decode failed for {relative_path}, trying latin-1.")
            try:
                 with open(filepath, 'r', encoding='latin-1') as f: html_content = f.read()
            except Exception as read_err: raise Exception(f"Failed read: {read_err}") from read_err
        if not html_content.strip(): raise ValueError("File is empty.")

        extracted_data = extract_chordpro_fields_from_html(html_content, str(filepath))
        raw_body = extracted_data.get('raw_song_body')
        if raw_body:
            try:
                parsed_body = parse_body_to_chordpro(raw_body)
                extracted_data['chordpro_body'] = parsed_body
            except Exception as body_parse_err:
                logger.error(f"Error parsing body for {relative_path}: {body_parse_err}")
                result_dict['error_message'] = f"Metadata OK, but body parse failed: {body_parse_err}"
                extracted_data['chordpro_body'] = None
        else:
            logger.warning(f"No raw song body found for {relative_path}")
            extracted_data['chordpro_body'] = None

        result_dict['status'] = 'success'
        result_dict['data'] = extracted_data
        result_dict['error_message'] = None

    except Exception as e:
        err_msg = f"{e.__class__.__name__}: {e}"
        result_dict['error_message'] = err_msg

    return result_dict


# --- ChordPro File Generation ---
# (No changes needed in this function)
def generate_and_save_pro_file(result_data, output_pro_dir, base_source_dir):
    """
    Generates ChordPro content and saves it to a .pro file.
    """
    metadata = result_data.get('data', {})
    if not metadata:
        logger.warning(f"No metadata found for {result_data.get('relative_path')}, cannot save .pro file.")
        return False

    output_pro_dir = Path(output_pro_dir)
    base_source_dir = Path(base_source_dir) # This is the specific source dir, e.g., .../www.site.com
    relative_path = Path(result_data.get('relative_path', 'unknown_file.html')) # Relative to 'sources/'

    # Create output path preserving subdirectory structure relative to output_pro_dir
    output_path = (output_pro_dir / relative_path).with_suffix('.pro')

    chordpro_content = []
    if metadata.get('title'): chordpro_content.append(f"{{title: {metadata['title']}}}")
    if metadata.get('artist'): chordpro_content.append(f"{{artist: {metadata['artist']}}}")
    if metadata.get('inferred_key'): chordpro_content.append(f"{{key: {metadata['inferred_key']}}}")
    original_html_path = metadata.get('filepath', result_data.get('filepath'))
    if original_html_path: chordpro_content.append(f"{{comment: Source HTML: {Path(original_html_path).name}}}")
    if metadata.get('disclaimer'): chordpro_content.append(f"{{comment: Disclaimer: {metadata['disclaimer']}}}")
    chordpro_content.append("") # Blank line before body

    parsed_body = metadata.get('chordpro_body')
    if parsed_body: chordpro_content.append(parsed_body)
    else: chordpro_content.append("{comment: Error: Song body could not be parsed.}")

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_string = "\n".join(chordpro_content)
        output_path.write_text(output_string, encoding='utf-8')
        # Log relative path from project root for clarity
        logger.info(f"Successfully saved: {output_path.relative_to(PROJECT_ROOT)}")
        return True
    except OSError as e:
        logger.error(f"Failed to write .pro file {output_path}: {e}")
        rel_path_for_error = str(relative_path.with_suffix('.pro'))
        error_logger.error(f"Failed to write file {rel_path_for_error}: {e}", extra={'filepath': str(relative_path)})
        return False
    except Exception as e:
        logger.error(f"Unexpected error writing .pro file {output_path}: {e}")
        rel_path_for_error = str(relative_path.with_suffix('.pro'))
        error_logger.error(f"Unexpected error writing file {rel_path_for_error}: {e}", extra={'filepath': str(relative_path)})
        return False


# --- Main Execution ---
# (No changes needed in core logic)
def main():
    parser = argparse.ArgumentParser(description="Parse HTML song files into ChordPro files.")
    parser.add_argument("-s", "--source", type=Path, default=DEFAULT_SOURCE_DIR, help=f"Directory containing HTML files for a specific source (default: {DEFAULT_SOURCE_DIR})")
    parser.add_argument("-p", "--pro-dir", type=Path, default=DEFAULT_OUTPUT_PRO_DIR, help=f"Output directory for generated .pro files (default: {DEFAULT_OUTPUT_PRO_DIR})")
    parser.add_argument("-w", "--workers", type=int, default=cpu_count(), help=f"Number of worker processes to use (default: {cpu_count()})")
    args = parser.parse_args()

    source_dir = args.source.resolve()
    output_pro_dir = args.pro_dir.resolve()
    num_workers = args.workers

    if not source_dir.is_dir():
        logger.error(f"Source directory not found or not a directory: {source_dir}")
        sys.exit(1)
    try: output_pro_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e: logger.error(f"Could not create output directory {output_pro_dir}: {e}"); sys.exit(1)

    logger.info(f"Starting ChordPro conversion process.")
    logger.info(f"Source Directory: {source_dir}")
    logger.info(f"Output Directory: {output_pro_dir}")
    logger.info(f"Log File: {LOG_FILE.resolve()}")
    logger.info(f"Error Log File: {ERROR_LOG_FILE.resolve()}")
    logger.info(f"Number of Workers: {num_workers}")

    logger.info("Scanning for HTML files...")
    html_files = list(source_dir.rglob('*.html'))
    html_files.extend(list(source_dir.rglob('*.htm')))
    html_files = list(set(html_files))

    if not html_files: logger.warning(f"No HTML/HTM files found in {source_dir}. Exiting."); sys.exit(0)
    logger.info(f"Found {len(html_files)} HTML/HTM files to process in '{source_dir.name}'.")

    start_time = time.time()
    successful_conversions, failed_parses, failed_saves, processed_count = 0, 0, 0, 0
    worker_func = partial(process_file, base_dir=source_dir)

    try:
        with Pool(processes=num_workers) as pool:
            results_iterator = pool.imap_unordered(worker_func, html_files)
            for result in results_iterator:
                processed_count += 1
                relative_path = result.get('relative_path', Path(result['filepath']).name)
                if result['status'] == 'success':
                    save_ok = generate_and_save_pro_file(result, output_pro_dir, source_dir)
                    if save_ok: successful_conversions += 1
                    else: failed_saves += 1
                    if processed_count % 50 == 0 or len(html_files) < 100: logger.info(f"Progress ({processed_count}/{len(html_files)}): Processed {relative_path}")
                else:
                    failed_parses += 1; error_msg = result['error_message']
                    error_logger.error(error_msg, extra={'filepath': str(relative_path)})
                    logger.error(f"Failed parsing ({processed_count}/{len(html_files)}): {relative_path} - See {ERROR_LOG_FILE.name} for details.")
    except KeyboardInterrupt: logger.warning("\nProcess interrupted by user..."); sys.exit(1)
    except Exception as e: logger.exception(f"An unexpected error occurred: {e}"); sys.exit(1)

    end_time = time.time(); duration = end_time - start_time
    logger.info("-" * 30 + "\nConversion Complete.")
    logger.info(f"Total files processed: {processed_count}")
    logger.info(f"Successful conversions (.pro saved): {successful_conversions}")
    logger.info(f"Parsing failures (metadata/body): {failed_parses}")
    logger.info(f"File save failures (after parse): {failed_saves}")
    logger.info(f"Duration: {duration:.2f} seconds")
    if failed_parses > 0 or failed_saves > 0: logger.warning(f"Found {failed_parses + failed_saves} total errors. Check '{ERROR_LOG_FILE.name}' for details.")
    logger.info(f"Output saved to: {output_pro_dir}")
    logger.info("-" * 30)

if __name__ == "__main__":
    main()