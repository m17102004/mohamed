import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared Gemini client on server side with required User-Agent
let aiClient: GoogleGenAI | null = null;
function getAIClient() {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function callGeminiWithRetry(params: any, retries = 2): Promise<any> {
  const ai = getAIClient();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const is503 = err?.message?.includes('503') || err?.status === 503;
      if (is503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// 1. AI Document Intelligence & Q&A with Citation Support
app.post('/api/ai/doc-intel', async (req, res) => {
  try {
    const { documentText, question, fileName, language } = req.body;

    if (!documentText || !question) {
      return res.status(400).json({ error: 'documentText and question are required' });
    }

    const ai = getAIClient();
    const systemPrompt = `You are PDF OS Document Intelligence Engine. 
You analyze documents with extreme precision, providing clear answers with verifiable page/section citations where available.
Language of response: ${language === 'ar' ? 'Arabic (العربية الفصحى الدقيقة)' : 'English'}.
Always structure your output with:
1. Direct Answer
2. Key Evidence / Citations (quoted fragments or paragraph references)
3. Confidence Level & Caveats (if information is incomplete or ambiguous)
Return formatted Markdown.`;

    const userPrompt = `Document: "${fileName || 'Document'}"\n\nContent:\n${documentText.slice(0, 30000)}\n\nUser Question:\n${question}`;

    const response = await callGeminiWithRetry({
      model: 'gemini-3.8-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
      },
    });

    res.json({ answer: response.text });
  } catch (error: any) {
    console.error('Doc Intel Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process document intelligence request' });
  }
});

// 2. AI Document Privacy Guardian (PII & Sensitive Data Scanner)
app.post('/api/ai/privacy-scan', async (req, res) => {
  try {
    const { documentText, fileName } = req.body;

    if (!documentText) {
      return res.status(400).json({ error: 'documentText is required' });
    }

    const ai = getAIClient();
    const prompt = `You are PDF OS Privacy Guardian. Audit the provided document text for sensitive data (PII, financial info, credentials, private identifiers, personal phone/email/addresses, government IDs).

Analyze this text and return a JSON object strictly matching this schema:
{
  "riskScore": number (0 to 100, where 0 is clean and 100 is critical risk),
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "summary": string,
  "detectedItems": [
    {
      "category": "Government ID" | "Financial" | "Contact Info" | "Credentials" | "Confidential Business",
      "sample": string (the exact snippet or masked form),
      "recommendation": string,
      "severity": "Low" | "Medium" | "High"
    }
  ],
  "redactionPlan": string
}

Document snippet:
${documentText.slice(0, 25000)}`;

    const response = await callGeminiWithRetry({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Privacy Scan Error:', error);
    res.status(500).json({ error: error.message || 'Failed to scan document privacy' });
  }
});

// 3. AI Document to Structured Data (Invoice/Table/Entity Extraction)
app.post('/api/ai/extract-data', async (req, res) => {
  try {
    const { documentText, targetFormat = 'table' } = req.body;

    if (!documentText) {
      return res.status(400).json({ error: 'documentText is required' });
    }

    const ai = getAIClient();
    const prompt = `Extract all tabular figures, key-value entities, line items, and invoice/report metadata from this document.
Format: return clean JSON with:
{
  "documentType": string (e.g. Invoice, Contract, Financial Report, Form),
  "entities": [ { "key": string, "value": string } ],
  "tables": [
    {
      "title": string,
      "headers": string[],
      "rows": string[][]
    }
  ],
  "keyDates": string[],
  "totals": string[]
}

Document content:
${documentText.slice(0, 30000)}`;

    const response = await callGeminiWithRetry({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Data Extraction Error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract structured data' });
  }
});

// 4. AI Document Workflow Builder
app.post('/api/ai/workflow-builder', async (req, res) => {
  try {
    const { naturalPrompt, language } = req.body;

    if (!naturalPrompt) {
      return res.status(400).json({ error: 'naturalPrompt is required' });
    }

    const ai = getAIClient();
    const prompt = `The user wants to automate a document workflow: "${naturalPrompt}".
Decompose this request into a step-by-step automated recipe of PDF OS actions.
Language: ${language === 'ar' ? 'Arabic' : 'English'}.
Return JSON strictly in this structure:
{
  "workflowTitle": string,
  "summary": string,
  "estimatedTimeSavings": string,
  "steps": [
    {
      "stepNumber": number,
      "tool": "Merge" | "Compress" | "PrivacyRedact" | "ExtractData" | "Watermark" | "Translate" | "ExportExcel",
      "actionDescription": string,
      "parameters": string
    }
  ],
  "outputDeliverables": string[]
}`;

    const response = await callGeminiWithRetry({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Workflow Builder Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate workflow' });
  }
});

// 5. Version Comparator & Layout-Preserving Translation Assistant
app.post('/api/ai/compare-docs', async (req, res) => {
  try {
    const { docA, docB, docAName, docBName, language } = req.body;

    if (!docA || !docB) {
      return res.status(400).json({ error: 'Both docA and docB are required' });
    }

    const ai = getAIClient();
    const prompt = `Compare these two document versions:
Version 1 (${docAName || 'Original'}):
${docA.slice(0, 15000)}

Version 2 (${docBName || 'Revised'}):
${docB.slice(0, 15000)}

Language: ${language === 'ar' ? 'Arabic' : 'English'}.
Provide a deep semantic diff analysis in JSON:
{
  "similarityScore": number (0 to 100),
  "changeSummary": string,
  "criticalChanges": [
    {
      "type": "Added" | "Removed" | "Modified" | "Financial Impact" | "Legal Clause",
      "description": string,
      "significance": "High" | "Medium" | "Low"
    }
  ],
  "sideBySideDifferences": [
    {
      "section": string,
      "originalSnippet": string,
      "revisedSnippet": string,
      "impact": string
    }
  ]
}`;

    const response = await callGeminiWithRetry({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Compare Docs Error:', error);
    res.status(500).json({ error: error.message || 'Failed to compare documents' });
  }
});

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PDF OS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
