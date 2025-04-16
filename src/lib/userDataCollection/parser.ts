import {
  CrmConfig,
  CrmDataField,
  CrmJsonData,
  FormContext,
  FormData,
  LegalConsentCommunication,
  LegalConsentOptions
} from './types'

const CONSENT_TEXT = 'I agree to receive email communications from OpenNMS';
const LEGAL_CONSENT_COMMUNICATION_TEXT = 'If you consent to us contacting you, please opt in below. We will maintain your data until you request us to delete it from our systems. You may opt out of receiving communications from us at any time.';
const CONTACT_OBJECT_ID = '0-1';

export const parseCrmData = (formData: FormData, config: CrmConfig): CrmJsonData => {
  const context = {
    pageName: `${config.crmPageName}`,
    pageUri: `${config.crmPageUri}`
  } as FormContext;

  const communication = {
    value: true,
    subscriptionTypeId: `${config.subscriptionTypeId}`,
    text: LEGAL_CONSENT_COMMUNICATION_TEXT
  } as LegalConsentCommunication;

  const legalConsentOptions = {
    consent: {
      consentToProcess: true,
      text: CONSENT_TEXT,
      communications: [communication]
    }
  } as LegalConsentOptions;

  const fieldValues = [
    { name: 'firstname', value: formData.firstName },
    { name: 'lastname', value: formData.lastName },
    { name: 'email', value: formData.email },
    { name: 'company', value: formData.company },
    { name: 'horizon_system_id', value: formData.systemId },
    { name: 'utm_campaign', value: 'Horizon' },
    { name: 'utm_medium', value: 'direct' },
    { name: 'utm_content', value: 'Horizon IForm' },
    { name: 'utm_term', value: '' }
  ];

  // UTC epoch milliseconds
  const submittedAt = Date.now();

  const jsonData = {
    fields: fieldValues.map(({ name, value }) => createField(name, value)),
    submittedAt,
    context,
    legalConsentOptions
  } as CrmJsonData;

  return jsonData;
}

const createField = (name: string, value: string) => {
  return {
    objectTypeId: CONTACT_OBJECT_ID,
    name,
    value
  } as CrmDataField;
}
