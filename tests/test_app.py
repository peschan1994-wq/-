import json
import os
import threading
import unittest
from io import BytesIO
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import AIError, Handler, InputError, analyze_card, create_stories, execute_task


BUSINESS = {"name": "Мастерская", "category": "Ремонт обуви", "city": "Самара", "facts": "Ремонт обуви и сумок", "contact": "+7 000 000-00-00"}


class ContentTests(unittest.TestCase):
    def test_stories_use_real_business_facts(self):
        result = create_stories({"business": BUSINESS, "platform": "both"})
        self.assertEqual(len(result["slides"]), 3)
        self.assertEqual(result["slides"][0]["title"], BUSINESS["name"])
        self.assertEqual(result["slides"][1]["body"], BUSINESS["facts"])
        self.assertIn(BUSINESS["contact"], result["slides"][2]["body"])
        self.assertEqual(result["mode"], "template")

    def test_offer_requires_conditions(self):
        with self.assertRaises(InputError):
            create_stories({"business": BUSINESS, "goal": "offer"})
        result = create_stories({"business": BUSINESS, "goal": "offer", "offer": "Скидка 10% до 15 октября"})
        self.assertEqual(result["slides"][2]["body"], "Скидка 10% до 15 октября")

    def test_service_requires_description(self):
        with self.assertRaises(InputError):
            create_stories({"business": {"name": "Бизнес"}, "goal": "service"})

    def test_empty_name_and_invalid_platform(self):
        for data in [{"business": {"name": " "}}, {"business": BUSINESS, "platform": "fake"}]:
            with self.assertRaises(InputError):
                create_stories(data)

    def test_analysis_distinguishes_unknown_from_zero(self):
        unknown = analyze_card({"platform": "yandex"})
        zero = analyze_card({"platform": "yandex", "photos": 0, "reviews": 0, "unanswered": 0})
        self.assertEqual(unknown["unknown"], 2)
        self.assertEqual(zero["unknown"], 0)
        self.assertIn("реальных клиентов", zero["items"][-1]["detail"])

    def test_complete_card_and_missing_details(self):
        data = {key: "Заполнено" for key in ["name", "category", "address", "phone", "hours", "description", "services"]}
        data.update(platform="2gis", photos=8, reviews=12, unanswered=0, rating=4.8)
        result = analyze_card(data)
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["priorities"], [])
        data.update(hours="", unanswered=3)
        result = analyze_card(data)
        self.assertLess(result["score"], 100)
        self.assertEqual([p["title"] for p in result["priorities"]], ["Часы работы", "Ответы на отзывы"])

    def test_invalid_counts(self):
        for data in [{"photos": -1}, {"reviews": 2, "unanswered": 3}, {"photos": 1.5}, {"rating": 6}, {"photos": True}, {"rating": float("nan")}]:
            with self.assertRaises(InputError):
                analyze_card(data)

    def test_card_url_is_validated_without_fetching(self):
        with patch("app.urlopen") as network:
            result = analyze_card({"platform": "2gis", "url": "https://2gis.ru/samara/firm/123"})
            network.assert_not_called()
        self.assertEqual(result["source"], "https://2gis.ru/samara/firm/123")
        for url in ["http://2gis.ru/a", "https://2gis.ru.evil.test/", "https://user:pass@2gis.ru/a", "https://yandex.ru/maps/"]:
            with self.assertRaises(InputError):
                analyze_card({"platform": "2gis", "url": url})

    def test_unconfigured_ai_reports_missing_connection(self):
        with patch.dict(os.environ, {"GEO_AI_API_KEY": ""}):
            with self.assertRaises(AIError) as error:
                execute_task({"business": BUSINESS, "task": "Составь план"})
        self.assertEqual(error.exception.status, 503)

    def test_ai_request_and_text_extraction(self):
        response = BytesIO(json.dumps({"output": [{"type": "message", "content": [{"type": "output_text", "text": "План историй"}]}]}).encode())
        with patch.dict(os.environ, {"GEO_AI_API_KEY": "test-only", "GEO_AI_MODEL": "test-model"}), patch("app.urlopen", return_value=response) as network:
            result = execute_task({"business": BUSINESS, "task": "Составь план"})
        self.assertEqual(result["text"], "План историй")
        request = network.call_args.args[0]
        body = json.loads(request.data)
        self.assertFalse(body["store"])
        self.assertEqual(body["model"], "test-model")
        self.assertIn("Мастерская", body["input"])
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")

    def test_ai_errors_do_not_echo_provider_secrets(self):
        with patch.dict(os.environ, {"GEO_AI_API_KEY": "test-only"}), patch("app.urlopen", side_effect=HTTPError("https://api.openai.com", 401, "private-provider-detail", {}, None)):
            with self.assertRaises(AIError) as error:
                execute_task({"business": BUSINESS, "task": "Составь план"})
        self.assertNotIn("private-provider-detail", str(error.exception))
        self.assertIn("Ключ", str(error.exception))


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, data, headers=None):
        request = Request(self.base + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json", **(headers or {})})
        return urlopen(request)

    def test_home_health_and_assets(self):
        with urlopen(self.base + "/") as response:
            self.assertIn("GeoStudio", response.read().decode())
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        with patch.dict(os.environ, {"GEO_AI_API_KEY": ""}), urlopen(self.base + "/api/health") as response:
            self.assertEqual(json.load(response), {"status": "ok", "ai_enabled": False})
        for path in ["/app.js", "/style.css", "/favicon.svg"]:
            with urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)

    def test_story_and_analysis_end_to_end(self):
        with self.request("/api/stories", {"business": BUSINESS}) as response:
            self.assertEqual(len(json.load(response)["slides"]), 3)
        with self.request("/api/analyze", {"platform": "2gis", "name": "Мастерская", "photos": 6}) as response:
            self.assertGreater(json.load(response)["score"], 0)

    def test_foreign_origin_cannot_submit(self):
        with self.assertRaises(HTTPError) as error:
            self.request("/api/stories", {"business": BUSINESS}, {"Origin": "https://another-site.test"})
        self.assertEqual(error.exception.code, 403)

    def test_wrong_data_type_is_rejected(self):
        with self.assertRaises(HTTPError) as error:
            self.request("/api/stories", ["invalid"])
        self.assertEqual(error.exception.code, 400)

    def test_unconfigured_task_is_not_reported_as_success(self):
        with patch.dict(os.environ, {"GEO_AI_API_KEY": ""}):
            with self.assertRaises(HTTPError) as error:
                self.request("/api/task", {"business": BUSINESS, "task": "Сделай план"})
        self.assertEqual(error.exception.code, 503)


if __name__ == "__main__":
    unittest.main()
