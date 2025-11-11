import ignore from 'ignore';
import type { ProviderInfo } from '~/types/model';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.
IMPORTANT: Vite is preferred
IMPORTANT: Only choose shadcn templates if the user explicitly asks for shadcn.

Available templates:
<template>
  <name>blank</name>
  <description>Empty starter for simple scripts and trivial tasks that don't require a full template setup</description>
  <tags>basic, script</tags>
</template>
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Response Format:
<selection>
  <templateName>{selected template name}</templateName>
  <title>{a proper title for the project}</title>
</selection>

Examples:

<example>
User: I need to build a todo app
Response:
<selection>
  <templateName>react-basic-starter</templateName>
  <title>Simple React todo application</title>
</selection>
</example>

<example>
User: Write a script to generate numbers from 1 to 100
Response:
<selection>
  <templateName>blank</templateName>
  <title>script to generate numbers from 1 to 100</title>
</selection>
</example>

Instructions:
1. For trivial tasks and simple scripts, always recommend the blank template
2. For more complex projects, recommend templates from the provided list
3. Follow the exact XML format
4. Consider both technical requirements and tags
5. If no perfect match exists, recommend the closest option

Important: Provide only the selection tags in your response, no additional text.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH 
`;

// Restrict selectable templates to the enforced stack
const ALLOWED_TEMPLATE_NAMES = ['Vite Shadcn'];
const templates: Template[] = STARTER_TEMPLATES.filter((t) => ALLOWED_TEMPLATE_NAMES.includes(t.name));

const parseSelectedTemplate = (llmOutput: string): { template: string; title: string } | null => {
  try {
    // Extract content between <templateName> tags
    const templateNameMatch = llmOutput.match(/<templateName>(.*?)<\/templateName>/);
    const titleMatch = llmOutput.match(/<title>(.*?)<\/title>/);

    if (!templateNameMatch) {
      return null;
    }

    return { template: templateNameMatch[1].trim(), title: titleMatch?.[1].trim() || 'Untitled Project' };
  } catch (error) {
    console.error('Error parsing template selection:', error);
    return null;
  }
};

export const selectStarterTemplate = async (options: { message: string; model: string; provider: ProviderInfo }) => {
  const { message, model, provider } = options;
  const requestBody = {
    message,
    model,
    provider,
    system: starterTemplateSelectionPrompt(templates),
  };
  const response = await fetch('/api/llmcall', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
  const respJson: { text: string } = await response.json();
  console.log(respJson);

  const { text } = respJson;
  const selectedTemplate = parseSelectedTemplate(text);

  if (selectedTemplate) {
    const allowedNames = new Set(templates.map((t) => t.name));
    const chosen =
      allowedNames.has(selectedTemplate.template) && selectedTemplate.template !== 'blank'
        ? selectedTemplate.template
        : templates[0]?.name || 'blank';

    return {
      template: chosen,
      title: selectedTemplate.title || 'Untitled Project',
    };
  }

  console.log('No template selected, defaulting to first allowed template');

  // Fallback to the first allowed starter when LLM selection fails
  const fallback = templates[0]?.name || 'blank';

  return {
    template: fallback,
    title: '',
  };
};

const getGitHubRepoContent = async (repoName: string): Promise<{ name: string; path: string; content: string }[]> => {
  try {
    // Instead of directly fetching from GitHub, use our own API endpoint as a proxy
    const response = await fetch(`/api/github-template?repo=${encodeURIComponent(repoName)}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Our API will return the files in the format we need
    const files = (await response.json()) as any;

    return files;
  } catch (error) {
    console.error('Error fetching release contents:', error);
    throw error;
  }
};

export async function getTemplates(templateName: string, title?: string) {
  const template = STARTER_TEMPLATES.find((t) => t.name == templateName);

  if (!template) {
    return null;
  }

  const githubRepo = template.githubRepo;
  let files: { name: string; path: string; content: string }[] = [];
  let usedFallbackSkeleton = false;

  // If GitHub fetch fails, build a minimal Vite+React skeleton to avoid blank template
  const buildFallbackSkeleton = () => {
    usedFallbackSkeleton = true;

    const skeletonFiles: { name: string; path: string; content: string }[] = [
      {
        name: 'package.json',
        path: 'package.json',
        content: `{
  "name": "vite-react-shadcn-skeleton",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}`,
      },
      {
        name: 'index.html',
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite React Shadcn Skeleton</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
      },
      {
        name: 'vite.config.ts',
        path: 'vite.config.ts',
        content: `import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  }
})`,
      },
      {
        name: 'tsconfig.json',
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "es2020",
    "module": "esnext",
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`,
      },
      {
        name: 'index.css',
        path: 'src/index.css',
        content: `@import "tailwindcss";`,
      },
      {
        name: 'main.tsx',
        path: 'src/main.tsx',
        content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`,
      },
      {
        name: 'App.tsx',
        path: 'src/App.tsx',
        content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <div className="min-h-svh flex flex-col items-center justify-center">
      <h1 className="text-2xl font-bold">Vite + React + Tailwind pronto</h1>
      <button className="mt-4 px-4 py-2 rounded bg-black text-white" onClick={() => setCount((c) => c + 1)}>
        Count {count}
      </button>
      <p className="mt-2 text-sm text-gray-500">Adicione shadcn/ui depois com o CLI.</p>
    </div>
  )
}`,
      },
    ];

    return skeletonFiles;
  };

  try {
    files = await getGitHubRepoContent(githubRepo);
  } catch (e) {
    console.warn('Falha ao importar template do GitHub. Usando esqueleto Vite local.', e);
    files = buildFallbackSkeleton();
  }

  let filteredFiles = files;

  /*
   * ignoring common unwanted files
   * exclude    .git
   */
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.git') == false);

  /*
   * exclude    lock files
   * WE NOW INCLUDE LOCK FILES FOR IMPROVED INSTALL TIMES
   */
  {
    /*
     *const comminLockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
     *filteredFiles = filteredFiles.filter((x) => comminLockFiles.includes(x.name) == false);
     */
  }

  // exclude    .bolt
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.bolt') == false);

  // check for ignore file in .bolt folder
  const templateIgnoreFile = files.find((x) => x.path.startsWith('.bolt') && x.name == 'ignore');

  const filesToImport = {
    files: filteredFiles,
    ignoreFile: [] as typeof filteredFiles,
  };

  if (templateIgnoreFile) {
    // redacting files specified in ignore file
    const ignorepatterns = templateIgnoreFile.content.split('\n').map((x) => x.trim());
    const ig = ignore().add(ignorepatterns);

    // filteredFiles = filteredFiles.filter(x => !ig.ignores(x.path))
    const ignoredFiles = filteredFiles.filter((x) => ig.ignores(x.path));

    filesToImport.files = filteredFiles;
    filesToImport.ignoreFile = ignoredFiles;
  }

  const MAX_IMPORT_CHARS = 250000;
  const PER_FILE_CHAR_LIMIT = 30000;

  const trimmedFiles: { path: string; content: string }[] = [];
  let budget = MAX_IMPORT_CHARS;

  // Prioritize essential files so npm scripts can run reliably
  const REQUIRED_FILE_NAMES = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'vite.config.ts',
    'vite.config.js',
    'index.html',
  ];
  const requiredSet = new Set<string>(REQUIRED_FILE_NAMES);
  const requiredFiles = filesToImport.files.filter((f) => requiredSet.has(f.name));
  const otherFiles = filesToImport.files.filter((f) => !requiredSet.has(f.name));
  const prioritizedFiles = [...requiredFiles, ...otherFiles];

  for (const f of prioritizedFiles) {
    if (budget <= 0) {
      break;
    }

    const originalLength = f.content.length;
    const truncatedContent =
      originalLength > PER_FILE_CHAR_LIMIT
        ? `${f.content.slice(0, PER_FILE_CHAR_LIMIT)}\n/* ... file content truncated for initial import ... */`
        : f.content;
    const overhead = 200 + f.path.length;
    const cost = truncatedContent.length + overhead;

    if (cost <= budget) {
      trimmedFiles.push({ path: f.path, content: truncatedContent });
      budget -= cost;
    } else {
      break;
    }
  }

  const omittedCount = Math.max(0, filesToImport.files.length - trimmedFiles.length);

  const assistantMessage = `
Bolt is initializing your project with the required files using the ${template.name} template.
<boltArtifact id="imported-files" title="${title || 'Create initial files'}" type="bundled">
${trimmedFiles
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>
<boltArtifact id="project-setup" title="Project Setup">
${(() => {
  // Detect package manager by lock files in the full file list (not only trimmed)
  const hasPnpmLock = filesToImport.files.some((f) => f.name === 'pnpm-lock.yaml');
  const hasYarnLock = filesToImport.files.some((f) => f.name === 'yarn.lock');
  const hasNpmLock = filesToImport.files.some((f) => f.name === 'package-lock.json');

  let installCmd = 'npm install';
  let startCmd = 'npm run dev';

  if (hasPnpmLock) {
    installCmd = 'pnpm install';
    startCmd = 'pnpm dev';
  } else if (hasYarnLock) {
    installCmd = 'yarn install';
    startCmd = 'yarn dev';
  } else if (hasNpmLock) {
    installCmd = 'npm install';
    startCmd = 'npm run dev';
  }

  return `<boltAction type="shell">${installCmd}</boltAction>\n<boltAction type="start">${startCmd}</boltAction>`;
})()}
</boltArtifact>
<boltArtifact id="template-snapshot" title="Template Snapshot">
<boltAction type="file" filePath=".bolt/snapshots/template.json">{
  "template": "${template.name}",
  "repo": "${githubRepo}",
  "importedFileCount": ${trimmedFiles.length},
  "omittedCount": ${omittedCount},
  "prioritizedFiles": ${JSON.stringify(requiredFiles.map((f) => f.path))}
}</boltAction>
</boltArtifact>
<boltArtifact id="webcontainer-snapshot" title="WebContainers Snapshot">
<boltAction type="file" filePath=".bolt/snapshots/webcontainer.md"># WebContainers Snapshot\n\nThe following commands will output environment details to the Terminal.\n\n- Node and npm versions\n- Current directory listing\n- Contents of package.json\n\nYou can re-run them later from the Terminal as needed.</boltAction>
<boltAction type="shell">node -v && npm -v && ls -la && cat package.json</boltAction>
</boltArtifact>
${omittedCount > 0 ? `\n/* ${omittedCount} file(s) omitted from initial chat import to keep the context size under control. The full template is available. Ask to open specific files when needed. */` : ''}`;
  let userMessage = ``;
  const templatePromptFile = files.filter((x) => x.path.startsWith('.bolt')).find((x) => x.name == 'prompt');

  if (templatePromptFile) {
    userMessage = `
TEMPLATE INSTRUCTIONS:
${templatePromptFile.content}

---
`;
  }

  if (filesToImport.ignoreFile.length > 0) {
    userMessage =
      userMessage +
      `
STRICT FILE ACCESS RULES - READ CAREFULLY:

The following files are READ-ONLY and must never be modified:
${filesToImport.ignoreFile.map((file) => `- ${file.path}`).join('\n')}

Permitted actions:
✓ Import these files as dependencies
✓ Read from these files
✓ Reference these files

Strictly forbidden actions:
❌ Modify any content within these files
❌ Delete these files
❌ Rename these files
❌ Move these files
❌ Create new versions of these files
❌ Suggest changes to these files

Any attempt to modify these protected files will result in immediate termination of the operation.

If you need to make changes to functionality, create new files instead of modifying the protected ones listed above.
---
`;
  }

  userMessage += `
---
template import is done, and you can now use the imported files,
edit only the files that need to be changed, and you can create new files as needed.
NO NOT EDIT/WRITE ANY FILES THAT ALREADY EXIST IN THE PROJECT AND DOES NOT NEED TO BE MODIFIED
---
Now that the Template is imported please continue with my original request

IMPORTANT: Dont Forget to install the dependencies before running the app by using \`npm install && npm run dev\`
`;

  if (usedFallbackSkeleton) {
    userMessage += `
NOTE: O import via GitHub falhou; para evitar projeto em branco, inicializei um esqueleto local Vite + React + Tailwind com script \`dev\` funcionando. Você pode depois rodar \`npx shadcn-ui@latest init\` para adicionar componentes shadcn/ui.`;
  }

  return {
    assistantMessage,
    userMessage,
  };
}
