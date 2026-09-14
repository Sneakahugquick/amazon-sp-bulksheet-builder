from __future__ import annotations

import json
import sys
from pathlib import Path

from openpyxl import load_workbook


EXPECTED_SHEETS = [
    "Portfolios",
    "Sponsored Products Campaigns",
    "Sponsored Display Campaigns",
    "Sponsored Brands Campaigns",
    "SB Multi Ad Group Campaigns",
    "RAS Campaigns",
    "Config",
]
EXPECTED_ENTITIES = ["Campaign", "Ad Group", "Product Ad", "Product Targeting"]
EXPECTED_TARGETS = {"close-match", "loose-match", "substitutes", "complements"}


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: verify_automatic_workbook.py <generated.xlsx>")

    path = Path(sys.argv[1]).resolve()
    workbook = load_workbook(path, data_only=False, read_only=False)
    assert workbook.sheetnames == EXPECTED_SHEETS, workbook.sheetnames
    assert workbook["Config"].sheet_state == "veryHidden"

    sheet = workbook["Sponsored Products Campaigns"]
    assert sheet.max_column == 32, sheet.max_column
    assert (sheet.max_row - 1) % 4 == 0, sheet.max_row
    campaign_count = (sheet.max_row - 1) // 4

    entities = [sheet.cell(row=row, column=2).value for row in range(2, sheet.max_row + 1)]
    for offset in range(0, len(entities), 4):
        assert entities[offset : offset + 4] == EXPECTED_ENTITIES

    campaign_rows = range(2, sheet.max_row + 1, 4)
    ad_group_rows = range(3, sheet.max_row + 1, 4)
    product_ad_rows = range(4, sheet.max_row + 1, 4)
    targeting_rows = range(5, sheet.max_row + 1, 4)

    campaign_ids = [sheet.cell(row=row, column=4).value for row in campaign_rows]
    targeting_types = [sheet.cell(row=row, column=14).value for row in campaign_rows]
    budgets = [sheet.cell(row=row, column=16).value for row in campaign_rows]
    skus = [sheet.cell(row=row, column=17).value for row in product_ad_rows]
    default_bids = [sheet.cell(row=row, column=18).value for row in ad_group_rows]
    target_bids = [sheet.cell(row=row, column=19).value for row in targeting_rows]
    expressions = [sheet.cell(row=row, column=27).value for row in targeting_rows]

    assert len(set(campaign_ids)) == campaign_count
    assert set(targeting_types) == {"AUTO"}
    assert set(expressions) == EXPECTED_TARGETS
    assert all(isinstance(value, (int, float)) and value > 0 for value in budgets)
    assert all(isinstance(value, (int, float)) and value > 0 for value in default_bids)
    assert target_bids == default_bids
    assert all(skus)

    print(json.dumps({
        "ok": True,
        "path": str(path),
        "sheets": workbook.sheetnames,
        "config_state": workbook["Config"].sheet_state,
        "sp_rows": sheet.max_row - 1,
        "sp_columns": sheet.max_column,
        "campaign_count": campaign_count,
        "entity_counts": {entity: entities.count(entity) for entity in EXPECTED_ENTITIES},
        "targeting_type": "AUTO",
        "targeting_expressions": sorted(set(expressions)),
        "skus": sorted(set(skus)),
        "daily_budget_total": round(sum(budgets), 2),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
