#!/usr/bin/env python3
"""A small, dependency-free API and static server for the flower counter."""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(__file__).resolve().parent / "flowers.db"
STUDENTS_PATH = Path(__file__).resolve().parent / "students.json"
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def initialize() -> None:
    names = json.loads(STUDENTS_PATH.read_text(encoding="utf-8"))
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort_order INTEGER NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS counts (
            student_id INTEGER NOT NULL REFERENCES students(id), month TEXT NOT NULL,
            count INTEGER NOT NULL CHECK(count >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(student_id, month))""")
        if db.execute("SELECT COUNT(*) FROM students").fetchone()[0] == 0:
            db.executemany("INSERT INTO students(name, sort_order) VALUES (?, ?)", [(name, i) for i, name in enumerate(names)])


def valid_month(value: str) -> bool:
    return bool(MONTH_RE.fullmatch(value))


def month_data(month: str) -> dict:
    with connect() as db:
        rows = db.execute("""SELECT s.id, s.name, s.sort_order, COALESCE(c.count, 0) AS count,
            CASE WHEN c.student_id IS NULL THEN 0 ELSE 1 END AS saved
            FROM students s LEFT JOIN counts c ON c.student_id=s.id AND c.month=?
            ORDER BY s.sort_order""", (month,)).fetchall()
    students = [{"id": r["id"], "number": r["sort_order"] + 1, "name": r["name"], "count": r["count"], "saved": bool(r["saved"])} for r in rows]
    ranked = sorted(students, key=lambda s: (-s["count"], s["id"]))
    last_count = None
    rank = 0
    for index, student in enumerate(ranked, 1):
        if student["count"] != last_count:
            rank = index
            last_count = student["count"]
        student["rank"] = rank
    return {"month": month, "students": students, "ranking": ranked[:10],
            "total": sum(s["count"] for s in students),
            "entered": sum(1 for s in students if s["saved"]),
            "class_size": len(students)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "frontend"), **kwargs)

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/month":
            month = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            if not valid_month(month):
                return self.send_json({"error": "月份格式应为 YYYY-MM"}, 400)
            return self.send_json(month_data(month))
        if parsed.path == "/api/export.csv":
            month = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            if not valid_month(month):
                return self.send_json({"error": "月份格式应为 YYYY-MM"}, 400)
            data = month_data(month)
            out = io.StringIO(newline="")
            writer = csv.writer(out)
            writer.writerow(["名次", "姓名", "小红花数量"])
            with connect() as db:
                rows = db.execute("""SELECT s.id,s.name,COALESCE(c.count,0) count FROM students s
                    LEFT JOIN counts c ON c.student_id=s.id AND c.month=? ORDER BY s.sort_order""", (month,)).fetchall()
            # Include every student; rank is computed across the full class, not only top ten.
            full = sorted([dict(r) for r in rows], key=lambda s: (-s["count"], s["id"]))
            last = None
            for i, item in enumerate(full, 1):
                if item["count"] != last:
                    rank = i
                    last = item["count"]
                writer.writerow([rank, item["name"], item["count"]])
            payload = ("\ufeff" + out.getvalue()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="flowers-{month}.csv"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if parsed.path.startswith("/api/"):
            return self.send_json({"error": "未找到接口"}, 404)
        if parsed.path == "/":
            self.path = "/index.html"
        elif parsed.path == "/entry":
            self.path = "/entry.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        one_match = re.fullmatch(r"/api/month/(\d{4}-\d{2})/student/(\d+)/count", parsed.path)
        if one_match:
            month, student_id = one_match.group(1), int(one_match.group(2))
            if not valid_month(month):
                return self.send_json({"error": "月份格式应为 YYYY-MM"}, 400)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                count = payload["count"]
                if isinstance(count, bool) or not (isinstance(count, int) or (isinstance(count, str) and count.isdigit())):
                    raise ValueError
                count = int(count)
                if count < 0 or count > 9999:
                    raise ValueError
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                return self.send_json({"error": "数量必须是 0 到 9999 的整数"}, 400)
            with connect() as db:
                exists = db.execute("SELECT 1 FROM students WHERE id=?", (student_id,)).fetchone()
                if not exists:
                    return self.send_json({"error": "没有找到这个学号"}, 404)
                db.execute("""INSERT INTO counts(student_id, month, count, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(student_id, month) DO UPDATE SET count=excluded.count, updated_at=CURRENT_TIMESTAMP""",
                    (student_id, month, count))
            return self.send_json(month_data(month))
        match = re.fullmatch(r"/api/month/(\d{4}-\d{2})/counts", parsed.path)
        if not match:
            return self.send_json({"error": "未找到接口"}, 404)
        month = match.group(1)
        if not valid_month(month):
            return self.send_json({"error": "月份格式应为 YYYY-MM"}, 400)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1_000_000:
                return self.send_json({"error": "提交内容过大"}, 413)
            payload = json.loads(self.rfile.read(length))
            counts = payload["counts"]
            if not isinstance(counts, dict):
                raise ValueError
            clean = {}
            for student_id, count in counts.items():
                sid = int(student_id)
                if isinstance(count, bool) or not (isinstance(count, int) or (isinstance(count, str) and count.isdigit())):
                    raise ValueError
                qty = int(count)
                if qty < 0 or qty > 9999:
                    raise ValueError
                clean[sid] = qty
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            return self.send_json({"error": "数量必须是 0 到 9999 的整数"}, 400)
        with connect() as db:
            valid_ids = {r[0] for r in db.execute("SELECT id FROM students")}
            if set(clean) != valid_ids:
                return self.send_json({"error": "提交名单与班级名单不一致，请刷新页面后重试"}, 400)
            db.executemany("""INSERT INTO counts(student_id, month, count, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, month) DO UPDATE SET count=excluded.count, updated_at=CURRENT_TIMESTAMP""",
                [(sid, month, qty) for sid, qty in clean.items()])
        return self.send_json(month_data(month))


if __name__ == "__main__":
    initialize()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("小红花统计器已启动：http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()
