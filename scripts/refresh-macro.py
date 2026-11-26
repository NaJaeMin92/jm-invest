"""Refresh the public macroeconomic calendar from published release schedules."""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup


BLS = "https://www.bls.gov/schedule/news_release/cpi.htm"
BEA = "https://www.bea.gov/news/schedule"
FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
NYFED = "https://www.newyorkfed.org/research/calendars/"
EASTERN = ZoneInfo("America/New_York")
BUNDLED = Path(__file__).resolve().parents[1] / "assets/market/calendar-macro.json"


def page(url):
    req = Request(url, headers={"User-Agent": "TradeInSight/1.0 (public economic release calendar)"})
    with urlopen(req, timeout=15) as response:
        return BeautifulSoup(response.read(), "html.parser")


def event(series, day, clock, source, url, estimated=False):
    at = datetime.combine(day, clock, tzinfo=EASTERN).astimezone(timezone.utc)
    return {"series": series, "at": at.isoformat(timespec="minutes"), "source": source,
            "url": url, "estimated": estimated}


def cpi_bls():
    releases = []
    for row in page(BLS).select("tr"):
        cells = [td.get_text(" ", strip=True) for td in row.select("td")]
        if len(cells) != 3 or not re.fullmatch(r"\d{1,2}:\d{2} [AP]M", cells[2]):
            continue
        month, rest = cells[1].replace(".", "").split(" ", 1)
        day = datetime.strptime(month[:3] + " " + rest, "%b %d, %Y").date()
        releases.append(event("CPI", day, datetime.strptime(cells[2], "%I:%M %p").time(), "BLS", BLS))
    return releases


def cpi_nyfed(month):
    url = NYFED + month.strftime("i-%b%y.html").lower()
    soup = page(url)
    heading = soup.get_text(" ", strip=True)
    if month.strftime("%B %Y").lower() not in heading.lower():
        raise ValueError("unexpected New York Fed calendar month")
    releases = []
    for link in soup.find_all("a", string=re.compile(r"^Consumer Price Index$")):
        cell = link.find_parent("td")
        day_text = next(cell.stripped_strings)
        clock = re.match(r"\((\d\d:\d\d)\)", str(link.find_next(string=re.compile(r"^\s*\(\d\d:\d\d\)"))).strip())
        if clock:
            releases.append(event("CPI", month.replace(day=int(day_text)),
                                  datetime.strptime(clock[1], "%H:%M").time(), "뉴욕 연은", url))
    return releases


def bea(url):
    releases = []
    for table in page(url).select("table"):
        year = re.search(r"Year (\d{4})", table.get_text(" ", strip=True))
        if not year:
            continue
        for row in table.select("tr"):
            title = row.select_one(".release-title")
            if not title:
                continue
            name = title.get_text(" ", strip=True)
            if "Personal Income and Outlays" in name:
                series = "PCE"
            elif re.match(r"(GDP|Gross Domestic Product)\s*\(", name):
                series = "GDP"
            else:
                continue
            stamp = row.select_one(".scheduled-date")
            if not stamp:
                continue
            text = stamp.get_text(" ", strip=True)
            match = re.fullmatch(r"(\w+ \d{1,2})\s+(\d{1,2}:\d{2} [AP]M)", text, re.I)
            if match:
                day = datetime.strptime(year[1] + " " + match[1], "%Y %B %d").date()
                releases.append(event(series, day, datetime.strptime(match[2], "%I:%M %p").time(), "BEA", url))
    return releases


def fed():
    releases = []
    for heading in page(FED).select(".panel-heading h4"):
        year = re.match(r"(\d{4}) FOMC Meetings", heading.get_text(strip=True))
        if not year or int(year[1]) < date.today().year - 1:
            continue
        panel = heading.find_parent(class_="panel")
        for meeting in panel.select(".fomc-meeting"):
            month = meeting.select_one(".fomc-meeting__month").get_text(strip=True)
            days = meeting.select_one(".fomc-meeting__date").get_text(strip=True)
            span = re.fullmatch(r"\d{1,2}\s*[-–]\s*(\d{1,2})\*?", days)
            if not span or "Monetary Policy Strategy Meeting" in meeting.get_text(" ", strip=True):
                continue
            # Some regular meetings run from one month into the next (e.g. Apr/May).
            month = month.split("/")[-1].strip()[:3]
            day = datetime.strptime(f"{year[1]} {month} {span[1]}", "%Y %b %d").date()
            clock = datetime.strptime("14:00", "%H:%M").time()
            estimated = not bool(meeting.select_one('a[href*="pressreleases/monetary"]'))
            url = FED
            if estimated and 0 <= (day - datetime.now(EASTERN).date()).days <= 62:
                monthly = "https://www.federalreserve.gov/newsevents/" + day.strftime("%Y-%B").lower() + ".htm"
                try:
                    title = page(monthly).find("p", string=lambda v: v and v.strip() == "FOMC Meeting")
                    if title:
                        row = title.find_parent(class_="row")
                        days = row.select_one(".col-xs-3").get_text(strip=True)
                        time_text = row.select_one(".col-xs-2").get_text(strip=True).replace(".", "")
                        if str(day.day) == days:
                            clock = datetime.strptime(time_text, "%I:%M %p").time()
                            estimated, url = False, monthly
                except (OSError, ValueError, AttributeError):
                    pass  # The meeting calendar supplies a tentative date until a timed agenda is available.
            releases.append(event("FOMC", day, clock, "Federal Reserve", url, estimated=estimated))
    return releases


def refresh(path):
    now = datetime.now(timezone.utc)
    today = now.astimezone(EASTERN).date()
    stamp = now.isoformat(timespec="seconds")
    previous_path = path if path.exists() else BUNDLED
    old = json.loads(previous_path.read_text()).get("events", []) if previous_path.exists() else []
    events = {(e["series"], e["at"][:10]): e for e in old}
    tasks = {"BLS": cpi_bls, "Fed": fed,
             "BEA": lambda: bea(BEA + "/full"), "BEA upcoming": lambda: bea(BEA + "/next-year")}
    successful = set()

    def replace(rows, group):
        rows = list(rows)
        if not rows:
            raise ValueError("no published schedules parsed")
        # Redated or withdrawn releases must disappear when an agency republishes its calendar.
        series = {row["series"] for row in rows}
        first, last = min(row["at"][:10] for row in rows), max(row["at"][:10] for row in rows)
        if group.startswith("BEA"):
            years = {row["at"][:4] for row in rows}
            keys = [key for key in events if key[0] in {"GDP", "PCE"} and key[1][:4] in years]
        elif group.startswith("NYFed"):
            months = {row["at"][:7] for row in rows}
            keys = [key for key in events if key[0] == "CPI" and key[1][:7] in months]
        else:
            keys = [key for key in events if key[0] in series and first <= key[1] <= max(last, today.isoformat())]
            if group == "BLS" or group == "Fed":
                keys += [key for key in events if key[0] in series and key[1] >= today.isoformat()]
        for key in keys:
            events.pop(key, None)
        for row in rows:
            row["checkedAt"] = stamp
            events[row["series"], row["at"][:10]] = row
        successful.add(group)

    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {group: pool.submit(fn) for group, fn in tasks.items()}
        for group, task in pending.items():
            try:
                replace(task.result(), group)
            except (OSError, ValueError) as error:
                print(f"{group}: {error}", file=sys.stderr)
        if "BLS" not in successful:
            month = today.replace(day=1)
            following = (month + timedelta(days=32)).replace(day=1)
            for day, task in [(d, pool.submit(cpi_nyfed, d)) for d in [month, following]]:
                try:
                    replace(task.result(), "NYFed " + str(day))
                except (OSError, ValueError) as error:
                    print(f"New York Fed {day}: {error}", file=sys.stderr)
    if not successful:
        raise SystemExit("All release feeds unavailable; preserving previous snapshot.")
    cutoff = (today - timedelta(days=400)).isoformat()
    rows = sorted((row for key, row in events.items() if key[1] >= cutoff), key=lambda e: (e["at"], e["series"]))
    if not {"CPI", "FOMC", "PCE"} <= {row["series"] for row in rows}:
        raise SystemExit("Essential schedule unavailable; preserving previous snapshot.")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"updatedAt": stamp, "events": rows}, ensure_ascii=False, indent=1) + "\n")
    tmp.replace(path)
    print(f"{len(rows)} economic releases from {', '.join(sorted(successful))}")


if __name__ == "__main__":
    refresh(Path(sys.argv[1]))
