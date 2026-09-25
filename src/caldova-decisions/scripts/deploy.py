#!/usr/bin/env python3
"""Deploy the Bicep resources; credentials travel through stdin, never argv."""

import argparse
import getpass
import ipaddress
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def azure(*args, payload=None):
    result = subprocess.run(
        ["az", *args, "-o", "json"],
        input=json.dumps(payload) if payload is not None else None,
        text=True, capture_output=True,
    )
    if result.returncode:
        # Do not echo deployment input or secrets when a command fails.
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("existing", "new"))
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--cluster", required=True)
    parser.add_argument("--location", default="swedencentral")
    parser.add_argument("--client-ip", required=True)
    parser.add_argument("--parameter-group", default="caldova-ai-pg17")
    parser.add_argument("--admin", default="horizonadmin")
    parser.add_argument("--action", choices=("validate", "what-if", "deploy"), default="validate")
    parser.add_argument("--full-diff", action="store_true", help="Print the complete ARM what-if result")
    args = parser.parse_args()
    ipaddress.IPv4Address(args.client_ip)
    common = ["--subscription", args.subscription]
    # Resource group creation is explicit and only performed for a new deployment.
    if args.mode == "new" and args.action == "deploy":
        azure("group", "create", "--name", args.resource_group,
              "--location", args.location, *common)
    cluster = {}
    if args.mode == "existing":
        cluster = azure("resource", "show", "-g", args.resource_group,
                        "-n", args.cluster, "--resource-type", "Microsoft.HorizonDB/clusters", *common)
        if cluster["location"] != args.location:
            parser.error("Parameter group and existing cluster must be in the same region")
    else:
        clusters = azure("resource", "list", "-g", args.resource_group,
                         "--resource-type", "Microsoft.HorizonDB/clusters", *common)
        if any(item["name"] == args.cluster for item in clusters):
            parser.error("Cluster already exists; use existing mode to preserve its configuration")
    parameters = {
        "clusterName": {"value": args.cluster},
        "location": {"value": args.location},
        "parameterGroupName": {"value": args.parameter_group},
        "clientIp": {"value": args.client_ip},
    }
    groups = azure("resource", "list", "-g", args.resource_group,
                   "--resource-type", "Microsoft.HorizonDB/parameterGroups", *common)
    reuse = any(group["name"] == args.parameter_group for group in groups)
    if reuse:
        group = azure("resource", "show", "-g", args.resource_group,
                      "-n", args.parameter_group, "--resource-type",
                      "Microsoft.HorizonDB/parameterGroups", *common)
        if group["location"] != args.location:
            parser.error("Existing parameter group is in a different region")
        values = {item["name"]: item.get("value") for item in group["properties"]["parameters"]}
        expected = {"azure.extensions": "azure_ai,pg_durable,vector",
                    "shared_preload_libraries": "pg_durable",
                    "require_secure_transport": "on", "ssl_min_protocol_version": "TLSv1.2"}
        if any(values.get(key) != value for key, value in expected.items()):
            parser.error("Parameter groups are immutable. Choose a new --parameter-group name for changed settings.")
    parameters["reuseParameterGroup"] = {"value": reuse}
    if args.mode == "new":
        parameters["administratorLogin"] = {"value": args.admin}
        parameters["administratorLoginPassword"] = {
            "value": getpass.getpass("New HorizonDB administrator password: ")
        }
    command = "create" if args.action == "deploy" else args.action
    action_flags = ["--no-pretty-print"] if args.action == "what-if" else []
    template = ROOT / "infra" / ("main.bicep" if args.mode == "new" else "existing.bicep")
    result = azure("deployment", "group", command,
                   "--name", "caldova-marketing-infra", "-g", args.resource_group,
                   "--template-file", str(template), "--parameters", "@/dev/stdin",
                   *action_flags, *common, payload=parameters)
    if args.action == "deploy" and args.mode == "existing":
        group_id = result["properties"]["outputs"]["parameterGroupId"]["value"]
        azure("rest", "--method", "patch", "--url",
              cluster["id"] + "?api-version=2026-05-01-preview",
              "--body", "@/dev/stdin", *common,
              payload={"properties": {"parameterGroup": {"id": group_id, "applyImmediately": True}}})
    if args.action == "what-if":
        summary = result if args.full_diff else {
            "status": result.get("status"),
            "changes": [{"resource": change["resourceId"], "change": change["changeType"]}
                        for change in result.get("changes", [])],
            "post_deployment": "Associate the parameter group using PATCH; this may restart the cluster."
                if args.mode == "existing" else None,
        }
        print(json.dumps(summary, indent=2))
    else:
        print(json.dumps({"action": args.action,
                          "state": result.get("properties", {}).get("provisioningState"),
                          "outputs": result.get("properties", {}).get("outputs", {})}, indent=2))


if __name__ == "__main__":
    main()
