import type { ContextProbe, SearchResult } from "./types.ts";

const GENERIC_MISSING_FIELDS = [
  "artifact",
  "purpose",
  "usual workflow",
  "formatting rules",
  "validation steps"
];

export function buildContextProbe(query: string, results: SearchResult[]): ContextProbe {
  const activeResults = results.filter((result) => !result.card.invalidatedAt);
  const sufficient = activeResults.some((result) => result.card.confidence >= 0.67 && result.score >= 0.2);
  const missingFields = sufficient ? [] : inferMissingFields(query);

  return {
    query,
    results: activeResults,
    sufficient,
    missingFields,
    questions: sufficient ? [] : buildQuestions(query, missingFields)
  };
}

export function buildQuestions(query: string, missingFields = inferMissingFields(query)): string[] {
  const normalized = query.toLowerCase();
  if (normalized.includes("planilha") || normalized.includes("spreadsheet") || normalized.includes("sheet")) {
    return [
      "Qual planilha voce quer atualizar?",
      "Para que essa planilha serve e quem usa o resultado?",
      "Qual e o passo a passo que voce costuma seguir para atualizar?",
      "Quais abas, colunas, formulas ou formatos precisam ser preservados?",
      "Como eu valido que a atualizacao ficou correta?"
    ];
  }

  if (normalized.includes("pr") || normalized.includes("pull request")) {
    return [
      "Qual repositorio ou branch esta em escopo?",
      "Qual e o objetivo da mudanca?",
      "Quais arquivos, testes ou checks costumam validar esse fluxo?",
      "Existe algum padrao de descricao, review ou rollout que eu preciso seguir?"
    ];
  }

  if (normalized.includes("documento") || normalized.includes("doc") || normalized.includes("apresentacao")) {
    return [
      "Qual documento esta em escopo?",
      "Quem e o publico e qual decisao o material precisa apoiar?",
      "Qual estrutura, tom e formatacao voce costuma usar?",
      "Onde devo buscar dados ou contexto confiavel?",
      "Como voce valida que a versao final esta pronta?"
    ];
  }

  return missingFields.map((field) => questionForField(field));
}

function inferMissingFields(query: string): string[] {
  const normalized = query.toLowerCase();
  if (normalized.includes("atualizar") || normalized.includes("update")) {
    return GENERIC_MISSING_FIELDS;
  }
  if (normalized.includes("criar") || normalized.includes("create")) {
    return ["artifact", "purpose", "audience", "source material", "validation steps"];
  }
  return GENERIC_MISSING_FIELDS;
}

function questionForField(field: string): string {
  const questions: Record<string, string> = {
    artifact: "Qual artefato ou sistema esta em escopo?",
    purpose: "Para que isso serve e qual resultado voce espera?",
    audience: "Quem vai usar ou ler o resultado?",
    "usual workflow": "Como voce costuma fazer isso hoje?",
    "formatting rules": "Quais regras de formato, layout ou nomenclatura devo preservar?",
    "validation steps": "Como eu valido que ficou certo?",
    "source material": "Quais fontes ou arquivos devo usar como verdade?"
  };
  return questions[field] ?? `O que preciso saber sobre ${field}?`;
}
