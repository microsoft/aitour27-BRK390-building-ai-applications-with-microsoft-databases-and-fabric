# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg[binary]>=3.2,<4"]
# ///
"""Register an existing Foundry deployment without printing its API key."""

import argparse
import json
import subprocess
import psycopg

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--subscription", required=True)
parser.add_argument("--resource-group", required=True)
parser.add_argument("--account", required=True)
parser.add_argument("--deployment", default="gpt-5.4-mini")
parser.add_argument("--alias", default="caldova-chat")
args = parser.parse_args()


def account_command(*parts):
    return json.loads(subprocess.check_output([
        "az", "cognitiveservices", "account", *parts,
        "--subscription", args.subscription,
        "--resource-group", args.resource_group,
        "--name", args.account, "-o", "json",
    ], text=True))


deployment = account_command("deployment", "show", "--deployment-name", args.deployment)
key = account_command("keys", "list")["key1"]
endpoint = f"https://{args.account}.openai.azure.com/"
with psycopg.connect("") as connection:
    # Parameters are bound; the key is neither printed nor included in command arguments.
    connection.execute(
        "SELECT model_registry.model_add(%s, %s, %s, %s, %s, %s, %s)",
        (args.alias, endpoint, args.deployment,
         deployment["properties"]["model"]["name"], None, "subscription-key", key),
    )
    result = connection.execute(
        "SELECT azure_ai.extract(document => %s, data => %s, model => %s)",
        ("Caldova requests 57000 additional sunscreen units.", ["incremental_units: integer"], args.alias),
    ).fetchone()[0]
    if not result:
        raise RuntimeError("Model registration succeeded but the extraction probe returned no data")
    print(json.dumps({"alias": args.alias, "extraction_probe": result}))
