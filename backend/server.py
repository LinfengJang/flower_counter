#!/usr/bin/env python3
"""Local API and static server for the flower counter."""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date
from email import policy
from email.parser import BytesParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import median
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(__file__).resolve().parent / "flowers.db"
STUDENTS_PATH = Path(__file__).resolve().parent / "students.json"
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def table_exists(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def initialize() -> None:
    names = json.loads(STUDENTS_PATH.read_text(encoding="utf-8"))
    with connect() as db:
        legacy = table_exists(db, "students") and "class_id" not in {r[1] for r in db.execute("PRAGMA table_info(students)")}
        if legacy:
            db.execute("ALTER TABLE students RENAME TO legacy_students")
            if table_exists(db, "counts"):
                db.execute("ALTER TABLE counts RENAME TO legacy_counts")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                number INTEGER NOT NULL, name TEXT NOT NULL, gender TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
                UNIQUE(class_id, number), UNIQUE(class_id, name));
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                month TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(class_id, month));
            CREATE TABLE IF NOT EXISTS counts (
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                count INTEGER NOT NULL CHECK(count >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(session_id, student_id));
        """)
        class_row = db.execute("SELECT id FROM classes WHERE name=?", ("一（1）班",)).fetchone()
        class_id = class_row[0] if class_row else db.execute("INSERT INTO classes(name) VALUES (?)", ("一（1）班",)).lastrowid
        if legacy:
            old_students = db.execute("SELECT * FROM legacy_students ORDER BY sort_order").fetchall()
            for order, student in enumerate(old_students):
                db.execute("INSERT INTO students(id,class_id,number,name,sort_order) VALUES (?,?,?,?,?)",
                           (student["id"], class_id, order + 1, student["name"], order))
            if not old_students:
                db.executemany("INSERT INTO students(class_id,number,name,sort_order) VALUES (?,?,?,?)",
                               [(class_id, i + 1, name, i) for i, name in enumerate(names)])
            if table_exists(db, "legacy_counts"):
                months = [r[0] for r in db.execute("SELECT DISTINCT month FROM legacy_counts ORDER BY month")]
                for month in months:
                    session_id = db.execute("INSERT INTO sessions(class_id,month) VALUES (?,?)", (class_id, month)).lastrowid
                    db.execute("""INSERT INTO counts(session_id,student_id,count,updated_at)
                        SELECT ?,student_id,count,updated_at FROM legacy_counts WHERE month=?""", (session_id, month))
                db.execute("DROP TABLE legacy_counts")
            db.execute("DROP TABLE legacy_students")
        elif db.execute("SELECT COUNT(*) FROM students WHERE class_id=?", (class_id,)).fetchone()[0] == 0:
            db.executemany("INSERT INTO students(class_id,number,name,sort_order) VALUES (?,?,?,?)",
                           [(class_id, i + 1, name, i) for i, name in enumerate(names)])


def valid_month(value: str) -> bool:
    return bool(MONTH_RE.fullmatch(value))


def session_data(session_id: int) -> dict | None:
    with connect() as db:
        session = db.execute("""SELECT ss.id,ss.class_id,ss.month,cl.name AS class_name
            FROM sessions ss JOIN classes cl ON cl.id=ss.class_id WHERE ss.id=?""", (session_id,)).fetchone()
        if not session:
            return None
        rows = db.execute("""SELECT s.id,s.number,s.name,s.gender,s.sort_order,
            COALESCE(c.count,0) AS count,CASE WHEN c.student_id IS NULL THEN 0 ELSE 1 END AS saved
            FROM students s LEFT JOIN counts c ON c.student_id=s.id AND c.session_id=?
            WHERE s.class_id=? ORDER BY s.sort_order""", (session_id, session["class_id"])).fetchall()
        history_rows = db.execute("""SELECT ss.month,SUM(c.count) AS total,COUNT(*) AS entered
            FROM sessions ss JOIN counts c ON c.session_id=ss.id
            WHERE ss.class_id=? AND ss.month<=? GROUP BY ss.month ORDER BY ss.month DESC LIMIT 12""",
                                  (session["class_id"], session["month"])).fetchall()
    students = [{"id": r["id"], "number": r["number"], "name": r["name"], "gender": r["gender"],
                 "count": r["count"], "saved": bool(r["saved"])} for r in rows]
    ranked = sorted((s for s in students if s["saved"]), key=lambda s: (-s["count"], s["number"]))
    last_count, rank = None, 0
    for index, student in enumerate(ranked, 1):
        if student["count"] != last_count:
            rank, last_count = index, student["count"]
        student["rank"] = rank
    values = [s["count"] for s in students if s["saved"]]
    frequencies = Counter(values)
    mode_frequency = max(frequencies.values(), default=0)
    modes = sorted(v for v, freq in frequencies.items() if freq == mode_frequency) if frequencies else []
    if values:
        maximum = max(values)
        width = 5 if maximum <= 40 else max(10, ((maximum + 7) // 8 + 9) // 10 * 10)
        distribution = [{"label": "0", "count": sum(v == 0 for v in values)}]
        for start in range(1, maximum + 1, width):
            end = min(start + width - 1, maximum)
            distribution.append({"label": f"{start}-{end}", "count": sum(start <= v <= end for v in values)})
    else:
        distribution = []
    return {"id": session["id"], "class_id": session["class_id"], "class_name": session["class_name"],
            "month": session["month"], "students": students, "ranking": ranked[:10],
            "total": sum(s["count"] for s in students), "entered": sum(s["saved"] for s in students),
            "class_size": len(students), "analytics": {
                "sample_size": len(values), "mean": round(sum(values) / len(values), 1) if values else None,
                "median": median(values) if values else None, "modes": modes, "mode_frequency": mode_frequency,
                "distribution": distribution,
                "trend": [{"month": r["month"], "total": r["total"], "entered": r["entered"]} for r in reversed(history_rows)]}}


def list_classes() -> list[dict]:
    with connect() as db:
        rows = db.execute("""SELECT c.id,c.name,COUNT(s.id) AS student_count
            FROM classes c LEFT JOIN students s ON s.class_id=c.id GROUP BY c.id ORDER BY c.id""").fetchall()
    return [dict(row) for row in rows]


def list_sessions() -> list[dict]:
    with connect() as db:
        rows = db.execute("""SELECT ss.id,ss.class_id,cl.name AS class_name,ss.month,ss.created_at,ss.updated_at,
            COUNT(c.student_id) AS entered,COALESCE(SUM(c.count),0) AS total,
            (SELECT COUNT(*) FROM students s WHERE s.class_id=ss.class_id) AS class_size
            FROM sessions ss JOIN classes cl ON cl.id=ss.class_id LEFT JOIN counts c ON c.session_id=ss.id
            GROUP BY ss.id ORDER BY ss.month DESC,cl.name,ss.id DESC""").fetchall()
    return [dict(row) for row in rows]


def overview_data() -> dict:
    with connect() as db:
        class_rows = db.execute("""SELECT cl.id,cl.name,COUNT(DISTINCT ss.id) AS sessions,
            COALESCE(SUM(c.count),0) AS total,COUNT(c.student_id) AS entered
            FROM classes cl LEFT JOIN sessions ss ON ss.class_id=cl.id
            LEFT JOIN counts c ON c.session_id=ss.id
            GROUP BY cl.id ORDER BY cl.id""").fetchall()
        trend_rows = db.execute("""SELECT ss.month,SUM(COALESCE(c.count,0)) AS total,
            COUNT(DISTINCT ss.id) AS sessions,COUNT(c.student_id) AS entered
            FROM sessions ss LEFT JOIN counts c ON c.session_id=ss.id
            GROUP BY ss.month ORDER BY ss.month DESC""").fetchall()
        session_totals = db.execute("""SELECT (SELECT COUNT(*) FROM sessions) AS sessions,
            COALESCE((SELECT SUM(count) FROM counts),0) AS flowers,
            (SELECT COUNT(*) FROM counts) AS entered,
            COALESCE((SELECT SUM((SELECT COUNT(*) FROM students s WHERE s.class_id=ss.class_id)) FROM sessions ss),0) AS expected""").fetchone()
    sessions = list_sessions()
    classes = [{"id": r["id"], "name": r["name"], "sessions": r["sessions"],
                "total": r["total"], "entered": r["entered"]} for r in class_rows]
    return {"class_count": len(classes), "session_count": session_totals["sessions"],
            "total": session_totals["flowers"], "entered": session_totals["entered"],
            "expected": session_totals["expected"], "classes": classes,
            "trend": [{"month": r["month"], "total": r["total"], "sessions": r["sessions"], "entered": r["entered"]}
                      for r in reversed(trend_rows)], "recent_sessions": sessions[:8],
            "session_summaries": sessions}


def parse_roster(content_type: str, body: bytes) -> list[dict]:
    envelope = b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    message = BytesParser(policy=policy.default).parsebytes(envelope)
    attachment = next((part for part in message.iter_parts() if part.get_filename()), None)
    if attachment is None:
        raise ValueError("请选择一个 Excel 或 CSV 名单文件")
    filename = attachment.get_filename() or ""
    content = attachment.get_payload(decode=True) or b""
    if filename.lower().endswith(".csv"):
        text = content.decode("utf-8-sig")
        matrix = list(csv.reader(io.StringIO(text)))
    elif filename.lower().endswith(".xlsx"):
        matrix = read_xlsx_rows(content)
    else:
        raise ValueError("仅支持 .xlsx 或 .csv 文件")
    if not matrix:
        raise ValueError("名单文件没有内容")
    headers = [str(v or "").strip().lower() for v in matrix[0]]
    name_idx = next((i for i, h in enumerate(headers) if "姓名" in h or h == "name"), None)
    if name_idx is None:
        raise ValueError("找不到姓名列，请在首行添加“姓名”列标题")
    number_idx = next((i for i, h in enumerate(headers) if any(key in h for key in ("序号", "学号", "number", "student id"))), None)
    gender_idx = next((i for i, h in enumerate(headers) if "性别" in h or h == "gender"), None)
    imported, seen_numbers, seen_names = [], set(), set()
    for row in matrix[1:]:
        name = str(row[name_idx]).strip() if name_idx < len(row) and row[name_idx] is not None else ""
        if not name:
            continue
        raw_number = str(row[number_idx]).strip() if number_idx is not None and number_idx < len(row) else str(len(imported) + 1)
        try:
            number = int(float(raw_number))
        except (ValueError, TypeError):
            raise ValueError(f"“{name}”这一行的序号不是数字")
        gender = str(row[gender_idx]).strip() if gender_idx is not None and gender_idx < len(row) else ""
        if number < 1 or number in seen_numbers or name in seen_names:
            raise ValueError(f"名单序号或姓名重复：{name}（{number}）")
        seen_numbers.add(number)
        seen_names.add(name)
        imported.append({"number": number, "name": name, "gender": gender})
    if not imported:
        raise ValueError("没有找到学生记录")
    imported.sort(key=lambda item: item["number"])
    return imported


def read_xlsx_rows(content: bytes) -> list[list[str]]:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            shared = []
            if "xl/sharedStrings.xml" in archive.namelist():
                root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                shared = ["".join(t.text or "" for t in item.findall(".//m:t", ns)) for item in root.findall("m:si", ns)]
            sheet_name = "xl/worksheets/sheet1.xml"
            if sheet_name not in archive.namelist():
                raise ValueError("Excel 文件中没有可读取的工作表")
            root = ET.fromstring(archive.read(sheet_name))
            result = []
            for row in root.findall(".//m:sheetData/m:row", ns):
                values = []
                for cell in row.findall("m:c", ns):
                    ref = cell.attrib.get("r", "A1")
                    letters = re.match(r"[A-Z]+", ref).group(0)
                    col = 0
                    for letter in letters:
                        col = col * 26 + ord(letter) - 64
                    while len(values) < col:
                        values.append("")
                    kind = cell.attrib.get("t")
                    value_node = cell.find("m:v", ns)
                    if kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall(".//m:t", ns))
                    elif value_node is None:
                        value = ""
                    elif kind == "s":
                        value = shared[int(value_node.text)]
                    else:
                        value = value_node.text or ""
                    values[col - 1] = value
                result.append(values)
            return result
    except zipfile.BadZipFile:
        raise ValueError("无法读取 Excel 文件，请确认文件格式正确")


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

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("提交内容过大")
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("请求内容格式错误")
        return data

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/classes":
            return self.send_json({"classes": list_classes()})
        if path == "/api/sessions":
            return self.send_json({"sessions": list_sessions()})
        if path == "/api/overview":
            return self.send_json(overview_data())
        match = re.fullmatch(r"/api/session/(\d+)", path)
        if match:
            data = session_data(int(match.group(1)))
            return self.send_json(data if data else {"error": "统计记录不存在"}, 200 if data else 404)
        match = re.fullmatch(r"/api/session/(\d+)/export\.csv", path)
        if match:
            data = session_data(int(match.group(1)))
            if not data:
                return self.send_json({"error": "统计记录不存在"}, 404)
            out = io.StringIO(newline="")
            writer = csv.writer(out)
            writer.writerow(["名次", "学号", "姓名", "性别", "小红花数量"])
            for student in sorted(data["students"], key=lambda s: (not s["saved"], -s["count"], s["number"])):
                writer.writerow([student.get("rank", "未登记"), student["number"], student["name"], student["gender"], student["count"] if student["saved"] else ""])
            payload = ("\ufeff" + out.getvalue()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="flowers-{data["id"]}-{data["month"]}.csv"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path.startswith("/api/"):
            return self.send_json({"error": "未找到接口"}, 404)
        pages = {"/": "/index.html", "/management": "/management.html", "/settings": "/settings.html", "/entry": "/entry.html", "/report": "/report.html"}
        self.path = pages.get(path, self.path)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/classes/(\d+)/students/import", path)
        if match:
            class_id = int(match.group(1))
            length = int(self.headers.get("Content-Length", "0"))
            if length > 12_000_000:
                return self.send_json({"error": "名单文件不能超过 12 MB"}, 413)
            try:
                students = parse_roster(self.headers.get("Content-Type", ""), self.rfile.read(length))
            except (ValueError, UnicodeDecodeError, KeyError, IndexError, ET.ParseError) as exc:
                return self.send_json({"error": str(exc)}, 400)
            with connect() as db:
                if not db.execute("SELECT 1 FROM classes WHERE id=?", (class_id,)).fetchone():
                    return self.send_json({"error": "班级不存在"}, 404)
                has_saved = db.execute("""SELECT 1 FROM sessions ss JOIN counts c ON c.session_id=ss.id
                    WHERE ss.class_id=? LIMIT 1""", (class_id,)).fetchone()
                if has_saved:
                    return self.send_json({"error": "这个班级已有已录入的统计数据，为保护历史记录暂不能替换名单。请新建班级后导入。"}, 409)
                db.execute("DELETE FROM students WHERE class_id=?", (class_id,))
                db.executemany("""INSERT INTO students(class_id,number,name,gender,sort_order)
                    VALUES (?,?,?,?,?)""", [(class_id, s["number"], s["name"], s["gender"], i) for i, s in enumerate(students)])
                db.execute("UPDATE sessions SET updated_at=CURRENT_TIMESTAMP WHERE class_id=?", (class_id,))
            return self.send_json({"imported": len(students), "students": students})
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_json({"error": str(exc) or "请求内容格式错误"}, 400)
        if path == "/api/classes":
            name = str(payload.get("name", "")).strip()
            if not name or len(name) > 40:
                return self.send_json({"error": "班级名称不能为空，且不能超过 40 个字"}, 400)
            try:
                with connect() as db:
                    class_id = db.execute("INSERT INTO classes(name) VALUES (?)", (name,)).lastrowid
            except sqlite3.IntegrityError:
                return self.send_json({"error": "这个班级名称已经存在"}, 409)
            return self.send_json({"id": class_id, "name": name, "student_count": 0}, 201)
        if path == "/api/sessions":
            class_id, month = payload.get("class_id"), payload.get("month", "")
            if not isinstance(class_id, int) or not valid_month(month):
                return self.send_json({"error": "请选择班级和有效月份"}, 400)
            with connect() as db:
                class_row = db.execute("SELECT name FROM classes WHERE id=?", (class_id,)).fetchone()
                if not class_row:
                    return self.send_json({"error": "班级不存在"}, 404)
                student_count = db.execute("SELECT COUNT(*) FROM students WHERE class_id=?", (class_id,)).fetchone()[0]
                if student_count == 0:
                    return self.send_json({"error": "请先在设置中导入这个班级的学生名单"}, 400)
                try:
                    cursor = db.execute("INSERT INTO sessions(class_id,month) VALUES (?,?)", (class_id, month))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "这个班级的月份统计已经创建"}, 409)
            return self.send_json({"id": cursor.lastrowid, "class_id": class_id, "class_name": class_row["name"], "month": month}, 201)
        match = re.fullmatch(r"/api/session/(\d+)/student/(\d+)/count", path)
        if match:
            session_id, student_id = map(int, match.groups())
            count = payload.get("count")
            if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 9999:
                return self.send_json({"error": "数量必须是 0 到 9999 的整数"}, 400)
            with connect() as db:
                allowed = db.execute("""SELECT 1 FROM sessions ss JOIN students s ON s.class_id=ss.class_id
                    WHERE ss.id=? AND s.id=?""", (session_id, student_id)).fetchone()
                if not allowed:
                    return self.send_json({"error": "学生不属于这次统计的班级"}, 404)
                db.execute("""INSERT INTO counts(session_id,student_id,count,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
                    ON CONFLICT(session_id,student_id) DO UPDATE SET count=excluded.count,updated_at=CURRENT_TIMESTAMP""",
                           (session_id, student_id, count))
                db.execute("UPDATE sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (session_id,))
            return self.send_json(session_data(session_id))
        return self.send_json({"error": "未找到接口"}, 404)

    def do_PUT(self):
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/session/(\d+)", path)
        if not match:
            return self.send_json({"error": "未找到接口"}, 404)
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_json({"error": str(exc) or "请求内容格式错误"}, 400)
        class_id, month = payload.get("class_id"), payload.get("month", "")
        if not isinstance(class_id, int) or not valid_month(month):
            return self.send_json({"error": "请选择班级和有效月份"}, 400)
        with connect() as db:
            if not db.execute("SELECT 1 FROM classes WHERE id=?", (class_id,)).fetchone():
                return self.send_json({"error": "班级不存在"}, 404)
            if db.execute("SELECT COUNT(*) FROM students WHERE class_id=?", (class_id,)).fetchone()[0] == 0:
                return self.send_json({"error": "请先为班级导入学生名单"}, 400)
            current = db.execute("SELECT class_id FROM sessions WHERE id=?", (int(match.group(1)),)).fetchone()
            if not current:
                return self.send_json({"error": "统计记录不存在"}, 404)
            if current["class_id"] != class_id and db.execute("SELECT 1 FROM counts WHERE session_id=? LIMIT 1", (int(match.group(1)),)).fetchone():
                return self.send_json({"error": "这次统计已经录入数据，不能更换班级；可以修改月份或继续编辑学生数量。"}, 409)
            try:
                db.execute("UPDATE sessions SET class_id=?,month=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (class_id, month, int(match.group(1))))
            except sqlite3.IntegrityError:
                return self.send_json({"error": "该班级的月份统计已经存在"}, 409)
            if db.total_changes == 0:
                return self.send_json({"error": "统计记录不存在"}, 404)
        return self.send_json(session_data(int(match.group(1))))

    def do_DELETE(self):
        match = re.fullmatch(r"/api/session/(\d+)", urlparse(self.path).path)
        if not match:
            return self.send_json({"error": "未找到接口"}, 404)
        with connect() as db:
            cursor = db.execute("DELETE FROM sessions WHERE id=?", (int(match.group(1)),))
            if cursor.rowcount == 0:
                return self.send_json({"error": "统计记录不存在"}, 404)
        return self.send_json({"deleted": True})


if __name__ == "__main__":
    initialize()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("小红花统计器已启动：http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()
