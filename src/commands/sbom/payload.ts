import * as console from 'console'
import crypto from 'crypto'

import {SpanTags} from '../../helpers/interfaces'
import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '../../helpers/tags'

import {getLanguageFromComponent} from './language'
import {Dependency, Location, LocationFromFile, Locations, ScaRequest} from './types'

// Parse a location from the file generated by osv-scanner into a location that can be
// sent to our API.
const parseLocation = (location: LocationFromFile): undefined | Location => {
  if (!location) {
    return undefined
  }
  if (
    !location.file_name ||
    !location.line_start ||
    !location.line_end ||
    !location.column_start ||
    !location.column_end
  ) {
    return undefined
  }

  if (location.line_end < location.line_start) {
    return undefined
  }

  if (location.line_end === location.line_start && location.column_end <= location.column_start) {
    return undefined
  }

  // check location values
  if (location.line_start <= 0 || location.line_end <= 0 || location.column_start <= 0 || location.column_end <= 0) {
    return undefined
  }

  return {
    file_name: location.file_name,
    start: {
      line: location.line_start,
      col: location.column_start,
    },
    end: {
      line: location.line_end,
      col: location.column_end,
    },
  }
}

// Parse all locations from the OSV scanner. If one fails to be parse, it's set to undefined
const parseLocationsString = (locations: string): undefined | Locations => {
  try {
    const parsed = JSON.parse(locations)

    const res: Locations = {
      block: parseLocation(parsed['block']),
      namespace: parseLocation(parsed['namespace']),
      name: parseLocation(parsed['name']),
      version: parseLocation(parsed['version']),
    }

    // if block is not defined, the API fails and we should rather ignore the payload
    if (!res.block) {
      return undefined
    }

    return res
  } catch (e) {
    console.error(`error when parsing locations: ${e}`)
  }

  return undefined
}

// Generate the payload we send to the API
// jsonContent is the SBOM file content read from disk
// tags are the list of tags we retrieved
export const generatePayload = (
  jsonContent: any,
  tags: SpanTags,
  service: string,
  env: string
): ScaRequest | undefined => {
  if (
    !tags[GIT_COMMIT_AUTHOR_EMAIL] ||
    !tags[GIT_COMMIT_AUTHOR_NAME] ||
    !tags[GIT_SHA] ||
    !tags[GIT_BRANCH] ||
    !tags[GIT_REPOSITORY_URL]
  ) {
    return undefined
  }

  const dependencies: Dependency[] = []

  if (jsonContent) {
    if (jsonContent['components']) {
      for (const component of jsonContent['components']) {
        if (!component['type'] || !component['name'] || !component['version']) {
          continue
        }
        if (component['type'] !== 'library') {
          continue
        }

        const lang = getLanguageFromComponent(component)

        if (!lang) {
          continue
        }

        const purl: string | undefined = component['purl']

        if (!purl) {
          console.error(`cannot find purl for component ${component['name']}`)
          continue
        }

        const locations: Locations[] = []

        // Extract the unique location strings from the file.
        const locationsStrings: Set<string> = new Set()
        if (component['evidence'] && component['evidence']['occurrences']) {
          for (const occ of component['evidence']['occurrences']) {
            if (occ['location']) {
              const loc: string = occ['location']

              if (!locationsStrings.has(loc)) {
                locationsStrings.add(loc)
              }
            }
          }
        }

        for (const l of locationsStrings) {
          const loc = parseLocationsString(l)
          if (loc) {
            locations.push(loc)
          }
        }

        const dependency: Dependency = {
          name: component['name'],
          group: component['group'] || undefined,
          version: component['version'],
          language: lang,
          licenses: [],
          purl,
          locations,
        }
        dependencies.push(dependency)
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    commit: {
      author_name: tags[GIT_COMMIT_AUTHOR_NAME],
      author_email: tags[GIT_COMMIT_AUTHOR_EMAIL],
      sha: tags[GIT_SHA],
      branch: tags[GIT_BRANCH],
    },
    repository: {
      url: tags[GIT_REPOSITORY_URL],
    },
    tags,
    dependencies,
    service,
    env,
    scan_source: 'ci',
  }
}
