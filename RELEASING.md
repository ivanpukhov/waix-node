# Publish to npm

The initial package name is `waix-node`. Before the first registry publication, sign in to npm with a maintainer account and complete npm's required 2FA. Run `npm test`, inspect `npm pack --dry-run`, then `npm publish --access public` from a reviewed release checkout. Do not paste npm tokens into issues or chat.

After the package exists, configure an npm **trusted publisher** for this repository, workflow filename `publish.yml`, environment `npm`. Add required reviewers to that GitHub environment. The manual workflow uses a GitHub-hosted runner, npm 11 and OIDC; it stores no long-lived registry token. Dispatch it at a reviewed version tag. npm package versions are immutable: change the version for a new release.

References: https://docs.npmjs.com/trusted-publishers/ and https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/.
