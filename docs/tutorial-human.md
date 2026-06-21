# Human Setup Tutorial

This markdown version mirrors the GitHub Pages walkthrough.

1. Initialize a local policy.
   ![Initialize local policy](./assets/screenshots/01-init.png)
2. Run the local MCP server.
   ![Run local MCP server](./assets/screenshots/02-run.png)
3. Optional: open the native app and review Policy Center.
   - Add approved workspace roots only when needed.
   - Add `/Users/YOUR_USERNAME/.codex/skills` as a skill root.
   - Do not approve the whole `.codex` directory.
   ![Policy Center](./assets/screenshots/09-policy-center.png)
4. Check `/health`.
   ![Health check](./assets/screenshots/03-health.png)
5. Expose a public HTTPS tunnel.
   ![Tunnel](./assets/screenshots/04-tunnel.png)
6. Create the ChatGPT connector.
   - Choose OAuth for public tunnels.
   - Choose No Authentication only for a short-lived private test.
   ![Connector settings](./assets/screenshots/05-connector.png)
7. Authorize with the local unlock code.
   ![OAuth authorize](./assets/screenshots/06-authorize.png)
8. For Linux paths, deploy a separate Linux bridge and connector.
   - Keep Linux `allowedProjectRoots` separate from Mac roots.
   - Prefer OAuth for the Linux connector.
9. Select the connector and test `file.list` or `file.read_path`.
   ![File list result](./assets/screenshots/07-success.png)
