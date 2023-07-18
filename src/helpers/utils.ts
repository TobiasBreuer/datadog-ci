import fs, {existsSync} from 'fs'
import {promisify} from 'util'

import type {SpanTag, SpanTags} from './interfaces'

import {AxiosRequestConfig, default as axios} from 'axios'
import {BaseContext, CommandClass, Cli} from 'clipanion'
import deepExtend from 'deep-extend'

import {getProxyAgent, ProxyConfiguration} from './proxy'

export const DEFAULT_CONFIG_PATHS = ['datadog-ci.json']

export const pick = <T extends Record<any, any>, K extends keyof T>(base: T, keys: K[]) => {
  const definedKeys = keys.filter((key) => !!base[key])
  const pickedObject: Partial<T> = {}

  for (const key of definedKeys) {
    pickedObject[key] = base[key]
  }

  return pickedObject
}

export const getConfig = async (configPath: string) => {
  try {
    const configFile = await promisify(fs.readFile)(configPath, 'utf-8')

    return JSON.parse(configFile)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Config file is not correct JSON')
    }
  }
}

const resolveConfigPath = ({
  configPath,
  defaultConfigPaths,
}: {
  configPath?: string
  defaultConfigPaths?: string[]
}): string | undefined => {
  if (configPath) {
    if (existsSync(configPath)) {
      return configPath
    }
    throw new Error('Config file not found')
  }

  if (defaultConfigPaths) {
    for (const path of defaultConfigPaths) {
      if (existsSync(path)) {
        return path
      }
    }
  }

  return undefined
}

export const parseOptionalInteger = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined
  }

  const number = parseFloat(value)
  if (!Number.isInteger(number)) {
    throw new Error(`${number} is not an integer`)
  }

  return number
}

/**
 * Applies configurations in this order of priority:
 * environment > config file > base config
 */
export const resolveConfigFromFileAndEnvironment = async <
  T extends Record<string, unknown>,
  U extends Record<string, unknown>
>(
  baseConfig: T,
  environment: U,
  params: {
    configPath?: string
    defaultConfigPaths?: string[]
    configFromFileCallback?: (configFromFile: any) => void
  }
): Promise<T & U> => {
  const configFromFile = await resolveConfigFromFile(baseConfig, params)

  if (params.configFromFileCallback) {
    params.configFromFileCallback(configFromFile)
  }

  return deepExtend(configFromFile, removeUndefinedValues(environment))
}

export const resolveConfigFromFile = async <T>(
  baseConfig: T,
  params: {configPath?: string; defaultConfigPaths?: string[]}
): Promise<T> => {
  const resolvedConfigPath = resolveConfigPath(params)
  if (!resolvedConfigPath) {
    return baseConfig
  }
  const parsedConfig = await getConfig(resolvedConfigPath)

  return deepExtend(baseConfig, parsedConfig)
}

/**
 * @deprecated Use resolveConfigFromFile instead for better error management
 */
export const parseConfigFile = async <T>(baseConfig: T, configPath?: string): Promise<T> => {
  try {
    const resolvedConfigPath = configPath ?? 'datadog-ci.json'
    const parsedConfig = await getConfig(resolvedConfigPath)

    return deepExtend(baseConfig, parsedConfig)
  } catch (e) {
    if (e.code === 'ENOENT' && configPath) {
      throw new Error('Config file not found')
    }

    if (e instanceof SyntaxError) {
      throw new Error('Config file is not correct JSON')
    }
  }

  return baseConfig
}

export interface RequestOptions {
  apiKey: string
  appKey?: string
  baseUrl: string
  headers?: Map<string, string>
  overrideUrl?: string
  proxyOpts?: ProxyConfiguration
}

export const getRequestBuilder = (options: RequestOptions) => {
  const {apiKey, appKey, baseUrl, overrideUrl, proxyOpts} = options
  const overrideArgs = (args: AxiosRequestConfig) => {
    const newArguments = {
      ...args,
      headers: {
        'DD-API-KEY': apiKey,
        ...(appKey ? {'DD-APPLICATION-KEY': appKey} : {}),
        ...args.headers,
      },
    }

    if (overrideUrl !== undefined) {
      newArguments.url = overrideUrl
    }

    const proxyAgent = getProxyAgent(proxyOpts)
    if (proxyAgent) {
      newArguments.httpAgent = proxyAgent
      newArguments.httpsAgent = proxyAgent
    }

    if (options.headers !== undefined) {
      options.headers.forEach((value, key) => {
        newArguments.headers[key] = value
      })
    }

    return newArguments
  }

  const baseConfiguration: AxiosRequestConfig = {
    baseURL: baseUrl,
    // Disabling proxy in Axios config as it's not working properly
    // the passed httpAgent/httpsAgent are handling the proxy instead.
    proxy: false,
  }

  return (args: AxiosRequestConfig) => axios.create(baseConfiguration)(overrideArgs(args))
}

export const getApiHostForSite = (site: string) => {
  switch (site) {
    case 'datad0g.com':
      return `app.${site}`
    case 'datadoghq.com':
    case 'datadoghq.eu':
    default:
      return `api.${site}`
  }
}

// The buildPath function is used to concatenate several paths. The goal is to have a function working for both unix
// paths and URL whereas standard path.join does not work with both.
export const buildPath = (...args: string[]) =>
  args
    .map((part, i) => {
      if (i === 0) {
        // For the first part, drop all / at the end of the path
        return part.trim().replace(/[\/]*$/g, '')
      } else {
        // For the following parts, remove all / at the beginning and at the end
        return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
      }
    })
    // Filter out empty parts
    .filter((x) => x.length)
    // Join all these parts with /
    .join('/')

export const removeEmptyValues = (tags: SpanTags) =>
  (Object.keys(tags) as SpanTag[]).reduce((filteredTags, tag) => {
    if (!tags[tag]) {
      return filteredTags
    }

    return {
      ...filteredTags,
      [tag]: tags[tag],
    }
  }, {})

export const removeUndefinedValues = <T extends {[key: string]: unknown}>(object: T): T => {
  const newObject = {...object}
  for (const [key, value] of Object.entries(newObject)) {
    if (value === undefined) {
      delete newObject[key]
    }
  }

  return newObject
}

export const normalizeRef = (ref: string | undefined) => {
  if (!ref) {
    return ref
  }

  return ref.replace(/origin\/|refs\/heads\/|tags\//gm, '')
}

export const pluralize = (nb: number, singular: string, plural: string) => {
  if (nb >= 2) {
    return `${nb} ${plural}`
  }

  return `${nb} ${singular}`
}

export const performSubCommand = (command: CommandClass<BaseContext>, commandArgs: string[], context: BaseContext) => {
  const cli = new Cli()
  cli.register(command)

  return cli.run(commandArgs, context)
}

export const filterSensitiveInfoFromRepository = (repositoryUrl: string | undefined) => {
  try {
    if (!repositoryUrl) {
      return repositoryUrl
    }
    if (repositoryUrl.startsWith('git@')) {
      return repositoryUrl
    }
    const {protocol, hostname, pathname} = new URL(repositoryUrl)
    if (!protocol || !hostname) {
      return repositoryUrl
    }

    return `${protocol}//${hostname}${pathname}`
  } catch (e) {
    return repositoryUrl
  }
}

// Removes sensitive info from the given git remote url and normalizes the url prefix.
// "git@github.com:" and "https://github.com/" prefixes will be normalized into "github.com/"
export const filterAndFormatGithubRemote = (rawRemote: string | undefined): string | undefined => {
  rawRemote = filterSensitiveInfoFromRepository(rawRemote)
  if (!rawRemote) {
    return rawRemote
  }
  rawRemote = rawRemote.replace(/git@github\.com:|https:\/\/github\.com\//, 'github.com/')

  return rawRemote
}

export const timedExecAsync = async <I, O>(f: (input: I) => Promise<O>, input: I): Promise<number> => {
  const initialTime = Date.now()
  await f(input)

  return (Date.now() - initialTime) / 1000
}
