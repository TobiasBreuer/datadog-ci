jest.mock('inquirer')
import {prompt} from 'inquirer'

import {confirmationQuestion, requestConfirmation} from '../prompt'

describe('prompt', () => {
  describe('confirmationQuestion', () => {
    test('returns question with provided message', async () => {
      const message = 'Do you want to continue?'
      const question = confirmationQuestion(message)
      expect(await question.message).toBe(message)
    })
  })

  describe('requestConfirmation', () => {
    test('returns boolean when users responds to confirmation question', async () => {
      ;(prompt as any).mockImplementation(() =>
        Promise.resolve({
          confirmation: true,
        })
      )

      const confirmation = await requestConfirmation('Do you want to continue?')
      expect(confirmation).toBe(true)
    })

    test('throws error when something unexpected happens while prompting', async () => {
      ;(prompt as any).mockImplementation(() => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await requestConfirmation('Do you wanna continue?')
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe("Couldn't receive confirmation. Unexpected error")
    })
  })
})
