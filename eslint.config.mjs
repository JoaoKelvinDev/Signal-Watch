import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(backend|api|app)(/|$)",
              message:
                "O frontend acessa o servidor por HTTP e usa apenas contratos compartilhados.",
            },
            {
              regex: "^(node:|pg$|drizzle-orm(?:/|$))",
              message: "Módulos de banco e Node.js devem permanecer no servidor.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/backend/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(frontend|api|app)(/|$)",
              message: "O backend não depende de componentes, rotas Next.js ou handlers HTTP.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(frontend|app)(/|$)",
              message: "A API delega ao backend; não importa interface nem adaptadores Next.js.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(frontend|backend|api|app)(/|$)",
              message: "Contratos compartilhados não dependem das camadas da aplicação.",
            },
            {
              regex: "^(node:|react(?:/|$)|next(?:/|$)|pg$|drizzle-orm(?:/|$))",
              message: "Mantenha os contratos independentes de UI, banco e runtime do servidor.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", ".local/**", ".npm-cache/**", "next-env.d.ts"]),
]);
