import { CrmConfig, CrmJsonData, FormData } from './types';
import { parseCrmData } from './parser';
import { Httpclient } from '../../httpclient';

export const postCrmData = async (config: CrmConfig, data: FormData) => {
  if (!validateFormData(data)) {
    console.error('Invalid form data received', data);
    throw new Error('Invalid form data');
  }  

  const crmData: CrmJsonData = parseCrmData(data, config.subscriptionTypeId);
  const client = new Httpclient(config.crmBaseUrl);
  const url = `${config.crmUrlPath}/${config.portalId}/${config.formGuid}`

  try {
      await client.post(url, crmData);

      console.log(`Successfully posted User Data Collection CRM data to url '${config.crmBaseUrl}${url}'`);
  } catch (e) {
      console.error(`Failed to post User Data Collection CRM data report to url '${config.crmBaseUrl}${url}'`, e);
      throw e;
  }
}

const validateFormData = (data: FormData): boolean => {
  if (!data ||
    !data.consent ||
    !data.email ||
    !data.product ||
    data.product.toLowerCase() !== 'horizon') {
      return false;
    }

  return true;
}

export const validateConfig = (config?: CrmConfig): boolean => {
  if (!config) {
    return false;
  }

  if (!config.crmBaseUrl ||
    !config.crmUrlPath ||
    !config.formGuid ||
    !config.portalId ||
    !config.subscriptionTypeId) {
      return false;
    }

    return true;
}
