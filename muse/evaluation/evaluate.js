import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { museRoot } from "../config.js";
import { scenarios } from "./scenarios.js";
import { runScenario } from "./checks.js";
import { recommend } from "../pipeline.js";
import { MemoryCatalog } from "../pipeline.js";

const root = museRoot();

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  let shared = 0;
  for (const id of a) if (b.has(id)) shared += 1;
  return shared / union.size;
}

function diversity(body) {
  const outfits = body.recommendations ?? [];
  if (outfits.length < 2) return null;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < outfits.length; i += 1) {
    for (let j = i + 1; j < outfits.length; j += 1) {
      total += jaccard(outfits[i].items, outfits[j].items);
      pairs += 1;
    }
  }
  return Number((total / pairs).toFixed(3));
}

function writeReport(results) {
  const lines = [
    "# Muse v1 evaluation",
    "",
    "The baseline is a fixed configuration. The same request returns the same outfits, scores, and reasons. This run does not measure a learned preference model. `learned_model` is false in every scenario.",
    "",
    "Checks on every scenario: recommended ids belong to the supplied wardrobe, no garment is repeated inside an outfit, hard rules accept every recommended garment, each outfit has a score in [0, 1] and at least one reason, and a second run matches the first.",
    "",
    "| Scenario | Result | Status | Outfits | Mean Jaccard |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const overlap = diversity(result.body);
    lines.push(
      `| ${result.title} | ${result.pass ? "pass" : "fail"} | ${result.body.status} | ${result.body.recommendations.length} | ${overlap == null ? "n/a" : overlap} |`,
    );
  }
  lines.push("", "## Notes", "");
  lines.push(
    "- Mean Jaccard is the average garment overlap between returned outfits. `n/a` means fewer than two outfits were returned. The wider-wardrobe scenario checks that the three returned outfits do not all reuse one top.",
  );
  lines.push(
    "- A formal request drops garments whose formality is casual. Garments with no formality stay eligible. Muse does not invent that missing formality.",
  );
  lines.push(
    "- Weather reasons appear only when the request has weather or season and at least one garment has a range, season, or unsuitable condition.",
  );
  lines.push(
    "- Conflicting favorite and disliked colors keep the dislike and return a `conflicting_color_preference` warning.",
  );
  lines.push(
    "- Empty wardrobes and rule-blocked wardrobes return lists, not invented garments. HTTP status stays 200. The body status is `empty_wardrobe` or `insufficient_candidates`.",
  );
  lines.push(
    "- Feedback was not part of these scenarios. Separate unit tests check that three likes can change order and that three dismissals without a reason do not delete an outfit. That adjustment is not a trained model.",
  );
  const failed = results.filter((result) => !result.pass);
  if (failed.length) {
    lines.push("", "## Failures", "");
    for (const result of failed) {
      lines.push(`- ${result.id}: ${result.problems.join("; ")}`);
    }
  }
  lines.push("");
  const reportPath = path.join(root, "reports", "evaluation_report.md");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n"));
  return reportPath;
}

function writeExample() {
  const wardrobe = JSON.parse(fs.readFileSync(path.join(root, "evaluation", "fixtures", "demo_wardrobe.json"), "utf8"));
  const body = {
    user_id: "user-123",
    occasion: "casual",
    weather: { temperature_c: 22 },
    wardrobe_item_ids: ["item-001", "item-002", "item-003", "item-004"],
    limit: 3,
  };
  const result = recommend(body, { catalog: new MemoryCatalog(wardrobe) });
  const exampleDir = path.join(root, "api", "examples");
  fs.mkdirSync(exampleDir, { recursive: true });
  fs.writeFileSync(path.join(exampleDir, "response.json"), `${JSON.stringify(result.body, null, 2)}\n`);
  return result;
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))) {
  const results = scenarios.map((scenario) => runScenario(scenario));
  const reportPath = writeReport(results);
  const example = writeExample();
  const failed = results.filter((result) => !result.pass);
  process.stdout.write(`${results.length - failed.length}/${results.length} scenarios passed\n`);
  process.stdout.write(`report ${reportPath}\n`);
  process.stdout.write(`example status ${example.body.status} outfits ${example.body.recommendations.length}\n`);
  if (failed.length) process.exitCode = 1;
}

export { writeReport, writeExample };
