/**
 * Home-screen routing for the Check tab.
 * Pure state — no DOM. The app applies visibility from getStep().
 */

export const HOME_OPTIONS = [
  {
    id: 'link',
    label: 'Paste an advert link',
    hint: 'Autotrader, Cinch and other listing pages.',
    icon: '🔗',
  },
  {
    id: 'plate',
    label: 'Look up a number plate',
    hint: "We'll fetch the official record and MOT history.",
    icon: '🚘',
  },
  {
    id: 'text',
    label: 'Paste the advert text',
    hint: 'Copy the title, price and mileage from the listing.',
    icon: '📋',
  },
  {
    id: 'screenshot',
    label: 'Upload a screenshot',
    hint: 'A photo or screenshot of the advert or the plate.',
    icon: '🖼️',
  },
];

export const INPUT_STEPS = HOME_OPTIONS.map((o) => o.id);

export function isInputStep(step) {
  return INPUT_STEPS.includes(step);
}

/**
 * @param {string} [initial]
 */
export function createHomeScreen(initial = 'home') {
  let step = initial === 'details' || isInputStep(initial) || initial === 'home' ? initial : 'home';
  let returnTo = 'home';

  return {
    getStep: () => step,
    getReturnTo: () => returnTo,
    showHome() {
      step = 'home';
      returnTo = 'home';
      return step;
    },
    /**
     * @param {string} id
     * @param {{ from?: string }} [opts]
     */
    openOption(id, { from } = {}) {
      if (!isInputStep(id)) return step;
      const origin = from || step;
      if (origin === 'details') returnTo = 'details';
      else if (origin === 'home') returnTo = 'home';
      step = id;
      return step;
    },
    showDetails() {
      step = 'details';
      returnTo = 'home';
      return step;
    },
    goBack() {
      if (isInputStep(step) && returnTo === 'details') {
        step = 'details';
        returnTo = 'home';
        return step;
      }
      step = 'home';
      returnTo = 'home';
      return step;
    },
  };
}

/**
 * Which named panels should be visible for a step.
 * Confirm, vehicle card and result keep their own hidden flags inside the details flow.
 *
 * @param {string} step
 * @param {{ workerOn?: boolean, fallback?: boolean }} [opts]
 */
export function panelsFor(step, { workerOn = false, fallback = false } = {}) {
  return {
    home: step === 'home',
    back: step !== 'home',
    link: step === 'link',
    plate: step === 'plate' || (step === 'details' && workerOn),
    text: step === 'text',
    screenshot: step === 'screenshot',
    details: step === 'details',
    fallback: step === 'details' && fallback,
  };
}
