"""Copy the published market figures from the SigmaRange watchlist."""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import urlopen

SOURCE = "https://sigmarange.com/"
NUMBER = r"\d[\d,]*(?:\.\d+)?"
CARD = re.compile(
    rf"\$({NUMBER})\s*([+−-]{NUMBER})%.*?([+−-]?{NUMBER})\s*σ"
    rf".*?\$({NUMBER})\s*[–−-]\s*\$({NUMBER})\s*±\s*({NUMBER})%"
)


class WatchlistParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.symbol = None
        self.parts = []
        self.symbols = {}

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            match = re.fullmatch(r"/symbol/([A-Z][A-Z0-9.-]{0,11})", dict(attrs).get("href", ""))
            self.symbol = match[1] if match else None
            self.parts = []

    def handle_data(self, data):
        if self.symbol and data.strip():
            self.parts.append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self.symbol:
            match = CARD.search(" ".join(self.parts))
            if match:
                self.symbols[self.symbol] = {
                    key: float(value.replace(",", "").replace("−", "-"))
                    for key, value in zip(("close", "change", "z", "low", "high", "move"), match.groups())
                }
            self.symbol = None


def read_date(page, key):
    match = re.search(rf'"{key}":\s*"(\d{{4}}-\d{{2}}-\d{{2}})"', page)
    if not match:
        raise ValueError(f"SigmaRange no longer supplies {key}")
    return match[1]


def refresh(destination):
    with urlopen(SOURCE, timeout=25) as response:
        page = response.read().decode("utf-8")
    parser = WatchlistParser()
    parser.feed(page)
    if len(parser.symbols) < 20:
        raise ValueError(f"Only {len(parser.symbols)} published symbols were parsed")

    metadata = page.replace(r'\"', '"')
    data = {
        "asOf": read_date(metadata, "sessionDate"),
        "from": read_date(metadata, "bandAnchorDate"),
        "through": read_date(metadata, "bandEndDate"),
        "symbols": parser.symbols,
    }
    # An upstream response can come from an older edge cache.
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        if (previous["from"], previous["asOf"]) > (data["from"], data["asOf"]):
            raise ValueError("SigmaRange published an older snapshot")
    destination.write_text(json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Read {len(parser.symbols)} SigmaRange symbols as of {data['asOf']}")


if __name__ == "__main__":
    refresh(Path(sys.argv[1]))
