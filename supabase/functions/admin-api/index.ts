import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAdminPassword(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supabase
    .from("admin_config")
    .select("admin_password")
    .eq("id", 1)
    .maybeSingle();
  return data?.admin_password ?? "SET_PUC123";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    let path = url.pathname;
    path = path.replace(/^\/functions\/v1\/admin-api/, "").replace(/^\/admin-api/, "");
    if (path === "") path = "/";

    const adminPassword = await getAdminPassword(supabase);

    // ── Admin Login ──────────────────────────
    if (path === "/login" && req.method === "POST") {
      const { password } = await req.json();
      if (!password || password !== adminPassword) {
        return json({ success: false, error: "Incorrect password" }, 401);
      }
      return json({ success: true, token: adminPassword });
    }

    // All other routes require admin auth
    const auth = req.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = auth.split(" ")[1];
    if (token !== adminPassword) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── List Students ─────────────────────────
    if (path === "/students" && req.method === "GET") {
      const { data, error } = await supabase
        .from("students")
        .select("roll_no, name, class_grade, stream, combination")
        .eq("stream", "Science")
        .order("roll_no", { ascending: true });

      if (error) return json({ error: error.message }, 500);
      return json({ success: true, students: data });
    }

    // ── Add Single Student ────────────────────
    if (path === "/student" && req.method === "POST") {
      const body = await req.json();
      const { roll_no, name, password, class_grade, stream, combination } = body;
      if (!roll_no || !name) return json({ error: "Roll number and name required" }, 400);
      if (String(stream || "").trim().toLowerCase() !== "science") {
        return json({ error: "Only Science students are supported" }, 400);
      }

      const { error } = await supabase.from("students").upsert({
        roll_no, name, password: password || roll_no, class_grade, stream, combination,
      }, { onConflict: "roll_no" });

      if (error) return json({ error: error.message }, 500);
      return json({ success: true, message: `Student ${roll_no} added` });
    }

    // ── Upload Excel ──────────────────────────
    if (path === "/upload-excel" && req.method === "POST") {
      const formData = await req.formData();
      const file = formData.get("file");
      const batchLabels: Record<string, string> = {
        "1st_puc_science": "1st PUC",
        "2nd_puc_science": "2nd PUC",
      };
      const classGrade = batchLabels[String(formData.get("batch") || "").trim()];
      if (!classGrade) return json({ error: "Please select a valid PUC batch" }, 400);
      const examType = String(formData.get("exam_type") || "monthly").trim().toLowerCase();
      if (examType !== "monthly" && examType !== "yearly") {
        return json({ error: "Please select a valid exam type" }, 400);
      }
      if (!file || !(file instanceof File)) {
        return json({ error: "No file uploaded" }, 400);
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);

      if (rows.length === 0) return json({ error: "Excel file is empty" }, 400);

      const nonSubjectKeys = new Set([
        "rollno", "rollnumber", "name", "studentname", "class", "classgrade", "stream", "combination",
        "totalmarks", "maxmarks", "totalmaxmarks", "examtype", "percentage", "collegerank", "streamrank",
      ]);

      const subjectKeyMap: Record<string, string> = {
        physics: "Physics", chemistry: "Chemistry", math: "Mathematics",
        "maths": "Mathematics", mathematics: "Mathematics", biology: "Biology",
        computer: "Computer Science", computerscience: "Computer Science",
        english: "English", hindi: "Hindi", kannada: "Kannada",
      };

      function normalizeKey(key: string): string {
        return String(key || "").trim().toLowerCase().replace(/[\s_.-]/g, "");
      }

      function getRowValue(row: Record<string, unknown>, aliases: string[]): unknown {
        const candidates = aliases.map(normalizeKey);
        for (const [key, value] of Object.entries(row)) {
          if (candidates.includes(normalizeKey(key))) return value;
        }
        return "";
      }

      function titleCase(key: string): string {
        return String(key || "").replace(/[_\-]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()).trim();
      }

      const parsedRows = rows.map((row: Record<string, unknown>) => {
        const rollNo = String(getRowValue(row, ["Roll No", "RollNo", "roll_no", "rollno", "roll number"]) || "").trim().toUpperCase();
        const name = String(getRowValue(row, ["Name", "name", "Student Name", "studentname"]) || "").trim();
        const combination = String(getRowValue(row, ["Combination", "combination", "comb"]) || "").trim();
        if (!rollNo || !name) return null;

        const hindiValue = getRowValue(row, ["Hindi"]);
        const kannadaValue = getRowValue(row, ["Kannada"]);
        const hasHindiMark = hindiValue !== undefined && hindiValue !== null && hindiValue !== "";
        const hasKannadaMark = kannadaValue !== undefined && kannadaValue !== null && kannadaValue !== "";
        if (hasHindiMark && hasKannadaMark) {
          return { error: `Student ${rollNo} cannot have both Hindi and Kannada marks in the same result` };
        }
        const headerKeys = Object.keys(row).map(normalizeKey);
        const hasHindiHeader = headerKeys.includes("hindi");
        const hasKannadaHeader = headerKeys.includes("kannada");
        const languageSubject = hasHindiMark || (hasHindiHeader && !hasKannadaHeader) ? "Hindi" : "Kannada";
        const normalizedCombination = combination.toUpperCase().replace(/[^A-Z]/g, "");
        const activeSubjects = normalizedCombination.includes("PCMB") || normalizedCombination.includes("BIOLOGY")
          ? [languageSubject, "English", "Mathematics", "Physics", "Chemistry", "Biology"]
          : normalizedCombination.includes("PCMC") || normalizedCombination.includes("COMPUTER")
            ? [languageSubject, "English", "Mathematics", "Physics", "Chemistry", "Computer Science"]
            : null;
        if (!activeSubjects) {
          return { error: `Combination must identify PCMC or PCMB (received: ${combination || "empty"})` };
        }

        const subjectMaxMarks: Record<string, number> = examType === "yearly"
          ? { English: 80, Hindi: 80, Kannada: 80, Mathematics: 80, Physics: 70, Chemistry: 70, "Computer Science": 70, Biology: 70 }
          : { English: 40, Hindi: 40, Kannada: 40, Mathematics: 40, Physics: 35, Chemistry: 35, "Computer Science": 35, Biology: 35 };
        const marks: Record<string, number> = {};
        let invalidMark: string | null = null;
        Object.entries(row).forEach(([key, value]) => {
          const nk = normalizeKey(key);
          if (nonSubjectKeys.has(nk)) return;
          if (value === undefined || value === null || value === "") return;
          const mark = parseInt(String(value), 10);
          if (Number.isNaN(mark)) return;
          const displayName = subjectKeyMap[nk] || titleCase(key);
          if (!activeSubjects.includes(displayName)) return;
          marks[displayName] = mark;
          if (mark < 0 || mark > subjectMaxMarks[displayName]) {
            invalidMark = `${displayName} must be between 0 and ${subjectMaxMarks[displayName]} for a ${examType} exam`;
          }
        });

        if (invalidMark) return { error: invalidMark };
        if (Object.keys(marks).length === 0) return null;

        const totalMarks = activeSubjects.reduce((sum, subject) => sum + (marks[subject] ?? 0), 0);
        const totalMaxMarks = examType === "yearly" ? 450 : 225;
        const percentage = parseFloat(((totalMarks / totalMaxMarks) * 100).toFixed(2));

        return { rollNo, name, classGrade, combination, marks, totalMarks, totalMaxMarks, examType, percentage };
      }).filter(Boolean) as Array<{
        rollNo: string; name: string; classGrade: string; combination: string; error?: string;
        marks: Record<string, number>; totalMarks: number; totalMaxMarks: number; examType: string; percentage: number;
      }>;

      const invalidRow = parsedRows.find((item) => item.error);
      if (invalidRow) return json({ error: invalidRow.error }, 400);
      if (parsedRows.length === 0) {
        return json({ error: "No valid students found. Use the required headers: Roll No, Name, Combination, Physics, Chemistry, Mathematics, Computer Science or Biology, English, and either Hindi or Kannada." }, 400);
      }

      let successCount = 0;
      for (const item of parsedRows) {
        const { error: studentError } = await supabase.from("students").upsert({
          roll_no: item.rollNo, name: item.name, password: item.rollNo,
          class_grade: classGrade, stream: "Science", combination: item.combination,
        }, { onConflict: "roll_no" });
        if (studentError) return json({ error: studentError.message }, 500);

        const { error: resultError } = await supabase.from("results").upsert({
          roll_no: item.rollNo,
          physics: item.marks.Physics ?? null,
          chemistry: item.marks.Chemistry ?? null,
          mathematics: item.marks.Mathematics ?? null,
          biology: item.marks.Biology ?? null,
          computer_science: item.marks["Computer Science"] ?? null,
          english: item.marks.English ?? null,
          hindi: item.marks.Hindi ?? null,
          kannada: item.marks.Kannada ?? null,
          exam_type: item.examType,
          total_max_marks: item.totalMaxMarks,
          total_marks: item.totalMarks,
          percentage: item.percentage,
        }, { onConflict: "roll_no" });
        if (resultError) return json({ error: resultError.message }, 500);

        successCount++;
      }

      return json({
        success: true,
        message: `Uploaded and ranked ${successCount} Science students!`,
        successCount,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("Admin API error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
