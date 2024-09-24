const { simpleGit } = require('simple-git');
const path = require("path");
const fs = require('node:fs/promises');
const directory = path.join(__dirname, "/work");
const YAML = require("yaml");

const options = {
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
};

const GIT = simpleGit(directory, options);

const fileExists = async path => !!(await fs.stat(path).catch(e => false));
const repoExists = async path => !!(await fs.stat(path).catch(e => false));

const defaultFilesExists = async (repoName) => {

  const contractPath = path.join(directory, repoName, "contract.yaml");
  const interfacePath = path.join(directory, repoName, "interface.yaml");
  const servicePath = path.join(directory, repoName, "service.yaml");

  const contractFileExists = await fileExists(contractPath);
  const interfaceFileExists = await fileExists(interfacePath);
  const serviceFileExists = await fileExists(servicePath);

  return [
    {
      name: "contract",
      path: contractPath,
      exists: contractFileExists,
    },
    {
      name: "interface",
      path: interfacePath,
      exists: interfaceFileExists,
    },
    {
      name: "service",
      path: servicePath,
      exists: serviceFileExists,
    },
  ];
};

const getRepoName = (url) => {
  const regex = /https:\/\/github\.com\/[^\/]+\/([^\/]+)\.git/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

const pullOrCloneRepo = async (url) => {
  const repoName = getRepoName(url);
  if (!repoName) throw new Error('Invalid repository URL');

  const repoPath = path.join(directory, repoName);
  const repoAlreadyCloned = await repoExists(repoPath);

  if (repoAlreadyCloned) {
    console.log(`Repository ${repoName} already exists. Pulling latest changes...`);
    await GIT.cwd(repoPath).pull(); // Pull latest changes
  } else {
    console.log(`Cloning repository ${repoName}...`);
    await GIT.clone(url, repoPath); // Clone the repository
  }
};

const getConfigFromRepo = async (url) => {
  /**
   * Fetches contract, service, interface from repo.
   * 1. Gets contract.yaml, interface.yaml, service.yaml from the repo URL.
   * 2. Parses them and returns as JSON.
   */
  const res = {};
  // if git direcoty exists pull, if it doesn't clone
  // this keep the sync agent in sync 
  await pullOrCloneRepo(url);

  const repoName = getRepoName(url);
  const coreFiles = await defaultFilesExists(repoName);
  
  // iterate over the default config files, get the YMAL and change each to JSON
  for (const file of coreFiles) {
    const { name, path, exists } = file;
    // if file exists read content and update, else null
    if (exists) {
      const fileContent = await fs.readFile(path, 'utf-8');
      res[name] = YAML.parse(fileContent);
    } else {
      res[name] = null;
    }
  }
  return res;
};

const performHandshakes = async (serviceConfig, contractConfig, interfaceConfig) => {
  /**
   * gets service, contract, interface config of the curr repo 
   * currently the simple example perform version check on the dependencies
   * in future this is extendable for health checks, different enviroments 
   * also checking the outpound swagger data in interface with the actual service swagger contract.  
   */
  
  // Get all services dynamically from desiredState
  const servicesToHandshake = Object.keys(serviceConfig.desiredState);

  // Initialize handshake results
  const handshakeResults = {};

  for (const serviceKey of servicesToHandshake) {
    const serviceDetails = serviceConfig.desiredState[serviceKey];
    const repoUrl = serviceDetails.repo;
    const serviceName = serviceDetails.dependencies[0].name;

    // Clone or pull the service's repo
    await pullOrCloneRepo(repoUrl);

    // Fetch the contract, interface, and service config from the repo
    const { contract, interface, service: depServiceConfig } = await getConfigFromRepo(repoUrl);

    // Perform handshake check (simple version: we compare contract version and dependencies)
    const contractMatches = contractConfig.version === contract.version;
    const dependenciesMatch = interfaceConfig.dependencies.some(dep => dep.name === serviceName);

    // Log result of handshake
    handshakeResults[serviceName] = {
      status: contractMatches && dependenciesMatch,
      message: contractMatches && dependenciesMatch 
        ? `Handshake successful with ${serviceName}`
        : `Handshake failed with ${serviceName}. Mismatch in contract or dependencies.`
    };
  }

  // Update the actual state in the serviceConfig
  serviceConfig.actualState = {
    lastChecked: new Date().toISOString(),
    handshakeStatus: Object.values(handshakeResults).every(res => res.status),
    details: handshakeResults
  };

  // Convert the updated serviceConfig to YAML
  const updatedYAML = YAML.stringify(serviceConfig);

  // Update the repos with the new handshake status
  await updateRepoWithNewYAML(serviceConfig.metadata.repo, updatedYAML);

  return serviceConfig.actualState;
};

// Function to update YAML in repo and commit changes
const updateRepoWithNewYAML = async (repoUrl, updatedYAML) => {
  const repoName = getRepoName(repoUrl);
  const repoPath = path.join(directory, repoName);
  
  // Path to service.yaml (where we want to update the YAML)
  const serviceFilePath = path.join(repoPath, "service.yaml");

  // Check if the file exists before writing
  if (await fileExists(serviceFilePath)) {
    // Write the updated YAML to service.yaml
    await fs.writeFile(serviceFilePath, updatedYAML, 'utf-8');

    // Commit and push changes
    await GIT.cwd(repoPath).add(serviceFilePath).commit("Updated handshake status").push();
  } else {
    throw new Error("service.yaml not found in repo: " + repoUrl);
  }
};

module.exports = {
  performHandshakes,
  getConfigFromRepo
};
