/**
 * User data received from an OpenNMS product instance.
 */
export interface FormData {
  product: string; // for now this should be 'Horizon', but could potentially be used for other products
  consent: boolean;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  systemId: string;
}

export interface CrmDataField {
  objectTypeId: string;
  name: string;
  value: string;
}

export interface FormContext {
  pageUri: string;
  pageName: string;
}

export interface LegalConsentCommunication {
  value: boolean;
  subscriptionTypeId: string;
  text: string;
}

export interface LegalConsent {
  communications: LegalConsentCommunication[];
  consentToProcess: boolean;
  text: string;
}

export interface LegalConsentOptions {
  consent: LegalConsent;
}

/**
 * Data to post to the CRM endpoint.
 */
export interface CrmJsonData {
  fields: CrmDataField[];
  submittedAt: number; // timestamp, epoch in ms
  context: FormContext;
  legalConsentOptions: LegalConsentOptions;
}

export interface CrmConfig {
  crmBaseUrl: string;
  crmUrlPath: string;
  portalId: string;
  formGuid: string;
  subscriptionTypeId: string;
}
