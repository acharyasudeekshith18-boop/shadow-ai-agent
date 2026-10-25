"""web_tools.py - tools that use free internet APIs (no API key needed).

    web_search  -> DuckDuckGo (the "ddgs" library)
    get_weather -> Open-Meteo (geocoding + forecast)
    wikipedia   -> Wikipedia REST API
"""

import requests

from shadow.tools import tool

HEADERS = {"User-Agent": "ShadowAgent/1.0 (student project)"}


@tool("web_search", "Searches the web (DuckDuckGo) and returns the top results.",
      {"query": "what to search for"})
def web_search(query):
    try:
        from ddgs import DDGS          # pip install ddgs
    except ImportError:
        return "ERROR: the ddgs package is not installed (pip install ddgs)"
    results = DDGS().text(str(query), max_results=4)
    if not results:
        return "No results found."
    return "\n".join(f"- {r['title']}: {r['body']} ({r['href']})" for r in results)


WEATHER_CODES = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog",
                 51: "light drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 80: "rain showers",
                 95: "thunderstorm"}


@tool("get_weather", "Current weather for a city.", {"city": "city name, e.g. 'Mysuru'"})
def get_weather(city):
    geo = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                       params={"name": city, "count": 1}, timeout=10).json()
    if not geo.get("results"):
        return f"I couldn't find a place called {city}."
    place = geo["results"][0]
    w = requests.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
        "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto",
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    }).json()["current"]
    sky = WEATHER_CODES.get(w["weather_code"], f"code {w['weather_code']}")
    return (f"{place['name']}: {w['temperature_2m']}°C, {sky}, humidity {w['relative_humidity_2m']}%, "
            f"wind {w['wind_speed_10m']} km/h")


@tool("wikipedia", "Short Wikipedia summary of a topic, person or place.", {"topic": "the topic"})
def wikipedia(topic):
    # opensearch finds the best matching title, then we fetch its summary.
    found = requests.get("https://en.wikipedia.org/w/api.php", headers=HEADERS, timeout=10, params={
        "action": "opensearch", "search": topic, "limit": 1, "format": "json"}).json()
    if not found[1]:
        return f"No Wikipedia article found for {topic}."
    title = found[1][0].replace(" ", "_")
    s = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}", headers=HEADERS, timeout=10).json()
    return f"{s.get('title')}: {s.get('extract')}"
