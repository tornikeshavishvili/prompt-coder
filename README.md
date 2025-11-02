# Prompt Coder

Generate/replace **raw code** from prompts written **inside comments**.  
Keeps your `@ai` markers. Strips Markdown code fences/backticks. Works with **Ollama**, **OpenAI**, or a **generic HTTP** backend.

---

## ✨ What it does

- Turn inline `@ai` comments into **real code** in your current file.
- **Never** deletes your directive lines.
- Removes ```/~~~ fences and inline backticks from model output.
- Inserts **after the directive** (single-line) or **replaces only the interior** (block).

---

## 🧩 Supported directives (case-insensitive)

### 1) Single-line generate

```js
// @ai generate: function sum(a,b) that returns a+b
```

➡️ Inserts generated code **after this line**.

### 2) Multi-line generate

```
@ai generate:
React button component with rounded corners and onClick logging "clicked"
@ai end
```

➡️ Keeps begin/end. **Replaces only** the lines between them.

### 3) Replace block

```
@ai replace begin: write a useState hook for "X"
const [x, setX] = useState('');
@ai replace end
```

➡️ Keeps begin/end. **Replaces only** the interior.

---

## 📝 Comment parsing (strict rule)

For `@ai generate:` and `@ai replace begin:` **inside comments**:

- If the **trimmed line starts with** a multi-line opener — `<!--`, `/*`, or `{/*` — we scan forward to the **first close** (`-->`, `*/`, `*/}`) and insert **after the close**.
- Otherwise, treat as **single-line**: prompt ends at **EOL** and we insert **after the line** (no forward scan).

This prevents “jumping” to a stray `*/` in strings later in the file.

---

## 🔧 Install

- From VSIX: Extensions → ⋮ → **Install from VSIX…**
- Or from Marketplace: search **“Prompt Coder”** (by your publisher).

> Requires VS Code **1.85.0+**.

---

## ⚙️ Settings (File → Preferences → Settings → “Prompt Coder”)

- `promptCoder.provider`: `ollama` | `openai` | `http` (default: `ollama`)
- `promptCoder.model`: model name/tag (e.g. `qwen2.5-coder:7b`, `gpt-4o-mini`)
- `promptCoder.endpoint`: server URL (Ollama/HTTP)
- `promptCoder.apiKey`: for OpenAI/HTTP (if required)
- `promptCoder.httpPath`: path for generic HTTP (default `/api/generate`)
- `promptCoder.maxTokens`: default **2048**
- `promptCoder.temperature`: default **0.2**
- `promptCoder.systemPrompt`: *“Return only code; no Markdown fences/backticks.”*
- `promptCoder.runOnSave`: process directives on save (off by default)
- `promptCoder.wrapSelectionWithCodeFence`: affects **Generate Here** only

### Backend quickstarts

**Ollama (local, default)**
- Install Ollama; run a code model (example):  
  `ollama pull qwen2.5-coder:7b`
- Settings:
  - provider: `ollama`
  - endpoint: `http://localhost:11434`
  - model: `qwen2.5-coder:7b`

**OpenAI**
- Settings:
  - provider: `openai`
  - apiKey: `sk-...`
  - model: e.g. `gpt-4o-mini`
  - temperature/maxTokens as needed

**Generic HTTP**
- Settings:
  - provider: `http`
  - endpoint: `http://localhost:3000`
  - httpPath: `/api/generate`
  - (optional) apiKey
  - model/temperature/maxTokens as needed

---

## ▶️ How to use

1. Write a directive in your code.
2. Click **“Run @ai”** above the line (CodeLens) — or use Command Palette:
   - **Prompt Coder: Process AI Comment At Line**
   - **Prompt Coder: Process Current AI Comment Only**
3. See the status bar: `🔄 Prompt running…` → `🚀 Prompt Coder`.
4. Use **“Stop”** to cancel.

---

## 🧪 Examples

### JavaScript

```js
// @ai generate: export function greet(name){ returns "Hello, <name>!" }
```

```js
/* @ai generate:
Create a debounce(fn, wait) utility
@ai end */
```

```js
// @ai replace begin: create singleton Logger with log()
const placeholder = () => {};
// @ai replace end
```

### React / JSX

```jsx
{/* @ai generate: useState hook for "X" default '' */}
```

```jsx
{/* @ai replace begin: button component "Click me" with rounded corners */}
<Button>TODO</Button>
{/* @ai replace end */}
```

### HTML

```html
<!-- @ai generate: blue rounded button titled "Click Me" with alert on click -->
```

### Python

```py
# @ai generate: def factorial(n): iterative, raises on negative
```

### SQL

```sql
-- @ai generate: create table users(id int primary key, name text not null)
```

---

## 🧼 Output sanitization (always on)

- Removes triple fences (``` / ~~~), keeps inner code only.
- If whole output is single-backtick wrapped, unwraps it.
- Trims blank edges and removes common left indentation.
- Inserts **exactly one trailing newline**.
- **No prose** or Markdown fences are written to your file.

---

## 🧭 Commands

- **Process AI Comment At Line** (CodeLens “Run @ai”)
- **Process Current AI Comment Only**
- **Process AI Comments (Generate/Replace)** — whole file
- **Stop Current Generation**
- Helpers:
  - **Generate Here (Insert/Replace Selection)**
  - **Generate & Replace Whole File**
  - **Generate Into New File**
- Utilities:
  - **Refresh CodeLens**
  - **Debug – Show Directive Matches**

---

## ✅ Guarantees

- Edits are **anchored to the directive**, not the cursor.
- Single-line: insert **after the line**.
- Block forms: **replace interior only**.
- Multi-line close scan runs **only** when the line starts with a block opener (`<!--`, `/*`, `{/*`).
- **Directives are never removed or altered.**

---

## 🛠️ Troubleshooting

- **No buttons shown**: ensure *Editor › Code Lens* is enabled; open an editable file (not a diff). Use **Prompt Coder: Refresh CodeLens**.
- **Inserted at wrong place**: check if your directive line actually starts with a block opener; otherwise it’s single-line → insert after EOL.
- **Output contains fences**: set/keep `systemPrompt` and verify your backend returns pure code.
- **Cancel errors**: use the **Stop** button; the extension cancels the HTTP request and doesn’t write partial output.

---

## 📄 License

MIT. Contributions welcome.
