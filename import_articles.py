"""
Import articles from https://wiki.makerfabs.com/ into wiki-system.
Scrapes the sitemap, fetches each article, converts HTML to Markdown, then imports via API.

Requirements:
    pip install requests beautifulsoup4 markdownify

Run this script AFTER the backend is started (port 8001).
"""
import requests
import re
import time
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote
from collections import OrderedDict

try:
    from bs4 import BeautifulSoup
    from markdownify import markdownify as md
except ImportError:
    print("Missing dependencies. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "beautifulsoup4", "markdownify"])
    from bs4 import BeautifulSoup
    from markdownify import markdownify as md

API = "http://localhost:8001/api"
SITEMAP_URL = "https://wiki.makerfabs.com/sitemap.xml"
BASE_URL = "https://wiki.makerfabs.com"

LOG_FILE = "F:/Code/wiki-system/import_log.txt"
log_file = open(LOG_FILE, "w", encoding="utf-8")


def log(msg):
    print(msg)
    log_file.write(msg + "\n")
    log_file.flush()


def get_admin_id():
    """Get or create admin user for importing."""
    try:
        resp = requests.get(f"{API}/users", timeout=5)
        resp.raise_for_status()
        users = resp.json()
        if users:
            return users[0]["id"]
    except requests.ConnectionError:
        log("ERROR: Backend is not running! Start it first with: start-backend.bat")
        sys.exit(1)
    except Exception as e:
        log(f"ERROR getting users: {e}")
        sys.exit(1)
    return None


def fetch_sitemap():
    """Fetch and parse sitemap.xml to get all article URLs."""
    log(f"Fetching sitemap from {SITEMAP_URL}...")
    resp = requests.get(SITEMAP_URL, timeout=30)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    # Handle XML namespace
    ns = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = []
    for url_elem in root.findall("ns:url", ns):
        loc = url_elem.find("ns:loc", ns)
        if loc is not None and loc.text:
            urls.append(loc.text.strip())

    # Filter out the homepage, keep only .html articles
    article_urls = [u for u in urls if u.endswith(".html")]
    log(f"Found {len(article_urls)} article URLs in sitemap")
    return article_urls


def url_to_title(url):
    """Extract a readable title from the URL."""
    # Get filename without extension
    filename = url.rsplit("/", 1)[-1].replace(".html", "")
    # URL decode
    title = unquote(filename)
    # Replace underscores with spaces
    title = title.replace("_", " ")
    return title.strip()


def categorize_url(url):
    """Assign a category based on URL/title keywords."""
    title_lower = url.lower()

    if "guidance" in title_lower and title_lower.endswith("guidance.html"):
        return "Guidance"
    if any(kw in title_lower for kw in ["squareline", "arduino", "esp-idf", "installing", "calibration",
                                          "download_mode", "flash_and_memory", "lvgl", "get_start"]):
        return "Guidance & Tutorials"
    if any(kw in title_lower for kw in ["matouch", "tft", "display", "lcd", "amoled", "e-ink",
                                          "sunton", "breakout", "rotary", "esp32-p4"]):
        return "Display & Touch Screen"
    if any(kw in title_lower for kw in ["uwb", "dw3000", "dw1000", "positioning"]):
        return "UWB Modules"
    if any(kw in title_lower for kw in ["home_assistant", "home-assistant", "home assistant",
                                          "esphome", "weather_station_for_home"]):
        return "Home Assistant"
    if any(kw in title_lower for kw in ["lora", "lorawan", "agrosense", "sensecap",
                                          "senselora", "soil_moisture", "soil_remote",
                                          "4g_lte", "cat1", "nbiot", "sim7670", "sim800",
                                          "sim808", "sim868", "a9g", "lte", "air_monitor",
                                          "air monitor"]):
        return "Communication & IoT"
    if any(kw in title_lower for kw in ["maduino", "maesp", "mapie", "pico", "esp32_oled",
                                          "esp8266", "nrf52840", "rp2040", "servo_driver"]):
        return "Development Boards"
    if any(kw in title_lower for kw in ["relay", "dimmer", "mabee", "anemometer", "wind",
                                          "shield", "motor", "voice", "espwatch",
                                          "industrial", "co2"]):
        return "Sensors & Accessories"
    if any(kw in title_lower for kw in ["stm32"]):
        return "Communication & IoT"

    return "Other"


def fetch_article(url, retries=3):
    """Fetch an article page and extract content as Markdown."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=30, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WikiImporter/1.0"
            })
            resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")

            # MkDocs Material theme: main content is in <article> or div.md-content__inner
            content_elem = soup.select_one("article.md-content__inner")
            if not content_elem:
                content_elem = soup.select_one(".md-content__inner")
            if not content_elem:
                content_elem = soup.select_one("article")
            if not content_elem:
                content_elem = soup.select_one(".md-content")
            if not content_elem:
                # Fallback: use main content area
                content_elem = soup.select_one("main .md-main__inner")

            if not content_elem:
                log(f"  WARNING: Could not find content element for {url}")
                return None

            # Remove navigation elements, edit buttons, etc.
            for elem in content_elem.select(".md-source, .md-footer, .md-tabs, nav, .headerlink, .md-nav"):
                elem.decompose()

            # Convert HTML to Markdown
            markdown_content = md(
                str(content_elem),
                heading_style="ATX",
                bullets="-",
                strip=["script", "style", "nav"],
            )

            # Clean up the markdown
            # Remove excessive blank lines
            markdown_content = re.sub(r"\n{4,}", "\n\n\n", markdown_content)
            # Remove leading/trailing whitespace
            markdown_content = markdown_content.strip()

            if len(markdown_content) < 20:
                log(f"  WARNING: Content too short for {url} ({len(markdown_content)} chars)")
                return None

            return markdown_content

        except requests.RequestException as e:
            if attempt < retries - 1:
                log(f"  Retry {attempt + 1}/{retries} for {url}: {e}")
                time.sleep(2)
            else:
                log(f"  ERROR fetching {url}: {e}")
                return None
    return None


def clear_existing_data():
    """Clear existing documents and nav nodes before import."""
    log("\n=== Clearing existing data ===")

    # Delete all nav nodes first (they reference documents)
    try:
        nav_resp = requests.get(f"{API}/nav")
        if nav_resp.status_code == 200:
            nav_nodes = nav_resp.json()
            for node in nav_nodes:
                requests.delete(f"{API}/nav/{node['id']}")
            log(f"  Deleted {len(nav_nodes)} nav nodes")
    except Exception as e:
        log(f"  Warning clearing nav nodes: {e}")

    # Delete all documents
    try:
        docs_resp = requests.get(f"{API}/docs")
        if docs_resp.status_code == 200:
            docs = docs_resp.json()
            for doc in docs:
                requests.delete(f"{API}/docs/{doc['id']}")
            log(f"  Deleted {len(docs)} documents")
    except Exception as e:
        log(f"  Warning clearing documents: {e}")


def main():
    log("=" * 60)
    log("Makerfabs Wiki Importer")
    log("=" * 60)

    # Step 1: Check backend and get admin user
    admin_id = get_admin_id()
    log(f"Admin user ID: {admin_id}")

    # Step 2: Fetch sitemap
    article_urls = fetch_sitemap()
    if not article_urls:
        log("No articles found in sitemap!")
        sys.exit(1)

    # Step 3: Clear existing data
    clear_existing_data()

    # Step 4: Categorize articles
    categorized = OrderedDict()
    for url in article_urls:
        category = categorize_url(url)
        if category not in categorized:
            categorized[category] = []
        categorized[category].append(url)

    log("\n=== Article categories ===")
    for cat, urls in categorized.items():
        log(f"  {cat}: {len(urls)} articles")

    # Step 5: Fetch and create articles
    log("\n=== Fetching and importing articles ===")
    created_docs = {}  # title -> doc_id
    doc_categories = {}  # title -> category
    total = len(article_urls)
    success_count = 0
    fail_count = 0

    for idx, url in enumerate(article_urls, 1):
        title = url_to_title(url)
        category = categorize_url(url)
        log(f"\n[{idx}/{total}] {title}")
        log(f"  URL: {url}")
        log(f"  Category: {category}")

        # Fetch article content
        content = fetch_article(url)
        if not content:
            fail_count += 1
            continue

        log(f"  Content length: {len(content)} chars")

        # Create document via API
        try:
            resp = requests.post(f"{API}/docs", json={
                "title": title,
                "content": content,
                "created_by": admin_id,
            }, timeout=10)

            if resp.status_code == 200:
                doc = resp.json()
                created_docs[title] = doc["id"]
                doc_categories[title] = category

                # Set to published
                requests.put(
                    f"{API}/docs/{doc['id']}",
                    json={"status": "published"},
                    params={"user_id": admin_id},
                    timeout=10,
                )
                log(f"  -> Created: {doc['id']}")
                success_count += 1
            else:
                log(f"  ! Failed: {resp.status_code} {resp.text[:200]}")
                fail_count += 1
        except Exception as e:
            log(f"  ! Error creating doc: {e}")
            fail_count += 1

        # Be polite to the server
        time.sleep(0.5)

    log(f"\n=== Document import summary ===")
    log(f"  Total URLs: {total}")
    log(f"  Created: {success_count}")
    log(f"  Failed: {fail_count}")

    # Step 6: Create navigation tree
    log("\n=== Creating navigation tree ===")
    nav_groups = {}  # category -> group_node_id
    sort_idx = 0

    # Sort categories for consistent ordering
    category_order = [
        "Guidance", "Guidance & Tutorials", "Display & Touch Screen",
        "UWB Modules", "Home Assistant", "Communication & IoT",
        "Development Boards", "Sensors & Accessories", "Other",
    ]

    for category in category_order:
        # Collect docs in this category
        cat_docs = [(title, doc_id) for title, doc_id in created_docs.items()
                     if doc_categories.get(title) == category]
        if not cat_docs:
            continue

        # Create group node
        try:
            resp = requests.post(f"{API}/nav", json={
                "title": category,
                "parent_id": None,
                "doc_id": None,
                "sort_order": sort_idx,
            }, timeout=10)

            if resp.status_code == 200:
                group = resp.json()
                nav_groups[category] = group["id"]
                log(f"  + Group: {category} ({len(cat_docs)} docs)")
                sort_idx += 1

                # Create child doc nodes
                for child_idx, (title, doc_id) in enumerate(cat_docs):
                    try:
                        resp2 = requests.post(f"{API}/nav", json={
                            "title": title,
                            "parent_id": group["id"],
                            "doc_id": doc_id,
                            "sort_order": child_idx,
                        }, timeout=10)
                        if resp2.status_code == 200:
                            log(f"    - {title}")
                        else:
                            log(f"    ! Nav failed for '{title}': {resp2.status_code}")
                    except Exception as e:
                        log(f"    ! Nav error for '{title}': {e}")
            else:
                log(f"  ! Failed to create group '{category}': {resp.status_code}")
        except Exception as e:
            log(f"  ! Error creating group '{category}': {e}")

    log(f"\n=== Navigation summary ===")
    log(f"  Groups created: {len(nav_groups)}")
    log(f"  Total docs in nav: {sum(len([(t, d) for t, d in created_docs.items() if doc_categories.get(t) == cat]) for cat in nav_groups)}")

    log("\n" + "=" * 60)
    log("Import complete!")
    log(f"Visit http://localhost:3001 to see the wiki editor.")
    log("=" * 60)
    log_file.close()


if __name__ == "__main__":
    main()
