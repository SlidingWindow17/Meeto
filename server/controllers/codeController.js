const JUDGE0_BASE_URL = process.env.JUDGE0_API_URL || "https://ce.judge0.com";

// Supported languages: only C++ and Java as requested
const LANGUAGE_CONFIG = {
    cpp: {
        id: 54, // C++ (GCC 9.2.0)
        name: "C++ (GCC 9.2.0)",
    },
    java: {
        id: 91, // Java (JDK 17.0.6)
        name: "Java (JDK 17.0.6)",
    },
};

// Safe helper to decode base64 strings returned by Judge0
function decodeBase64(str) {
    if (!str || typeof str !== "string") return "";
    try {
        return Buffer.from(str, "base64").toString("utf-8");
    } catch {
        return str;
    }
}

export const runCode = async (req, res) => {
    try {
        const { code, language = "cpp", stdin = "" } = req.body;

        if (!code || typeof code !== "string" || !code.trim()) {
            return res.status(400).json({ error: "Code cannot be empty" });
        }

        const langKey = language.toLowerCase();
        const selectedLang = LANGUAGE_CONFIG[langKey];

        if (!selectedLang) {
            return res.status(400).json({
                error: `Unsupported language. Only 'cpp' and 'java' are supported.`,
            });
        }

        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        };

        if (process.env.RAPIDAPI_KEY) {
            headers["X-RapidAPI-Key"] = process.env.RAPIDAPI_KEY;
            headers["X-RapidAPI-Host"] = process.env.RAPIDAPI_HOST || "judge0-ce.p.rapidapi.com";
        }

        // Use base64_encoded=true to handle all compiler warnings, unicode, and special syntax chars
        const submissionUrl = `${JUDGE0_BASE_URL.replace(/\/$/, "")}/submissions?base64_encoded=true&wait=true`;

        const encodedSource = Buffer.from(code).toString("base64");
        const encodedStdin = stdin ? Buffer.from(stdin).toString("base64") : "";

        const response = await fetch(submissionUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                source_code: encodedSource,
                language_id: selectedLang.id,
                stdin: encodedStdin,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Judge0 submission error:", response.status, errorText);
            return res.status(response.status).json({
                error: `Execution engine error (${response.status}): ${errorText || "Submission failed"}`,
            });
        }

        const result = await response.json();

        // Safely decode base64 fields from Judge0
        const stdout = decodeBase64(result.stdout);
        const stderr = decodeBase64(result.stderr);
        const compileOutput = decodeBase64(result.compile_output);
        const message = decodeBase64(result.message);
        const statusDescription = result.status?.description || "Unknown";
        const statusId = result.status?.id;

        // Status ID 3 is "Accepted"
        const isError = statusId !== 3;

        let combinedOutput = "";
        if (compileOutput) {
            combinedOutput += `Compilation Output:\n${compileOutput}\n`;
        }
        if (stderr) {
            combinedOutput += `Runtime / Stderr:\n${stderr}\n`;
        }
        if (message) {
            combinedOutput += `Message: ${message}\n`;
        }
        if (stdout) {
            combinedOutput += stdout;
        }
        if (!combinedOutput) {
            combinedOutput = isError
                ? `Finished with status: ${statusDescription}`
                : "(Program produced no output)";
        }

        return res.json({
            success: !isError,
            isError,
            status: statusDescription,
            statusId,
            output: combinedOutput.trimEnd(),
            stdout,
            stderr,
            compileOutput,
            time: result.time ? `${result.time} s` : null,
            memory: result.memory ? `${result.memory} KB` : null,
        });
    } catch (error) {
        console.error("runCode controller exception:", error);
        return res.status(500).json({
            error: "Failed to execute code via Judge0: " + (error.message || "Unknown error"),
        });
    }
};
