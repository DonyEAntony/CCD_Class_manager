const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const getConfig = () => ({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || '',
  location: process.env.GOOGLE_CLOUD_LOCATION || '',
  processorId: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID || '',
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  credentialsJson: process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON || '',
  credentialsBase64: process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_B64 || '',
});

const sanitizeText = (value) => (value || '').replace(/\r/g, '').trim();

const parseInlineCredentials = (config) => {
  const rawJson = config.credentialsJson
    || (config.credentialsBase64 ? Buffer.from(config.credentialsBase64, 'base64').toString('utf8') : '');

  if (!rawJson) return null;

  const parsed = JSON.parse(rawJson);
  return {
    client_email: parsed.client_email || '',
    private_key: parsed.private_key || '',
  };
};

const isConfigured = () => {
  const config = getConfig();
  return Boolean(config.projectId && config.location && config.processorId);
};

const createClient = () => {
  const config = getConfig();
  const clientOptions = {};
  const inlineCredentials = parseInlineCredentials(config);
  if (inlineCredentials?.client_email && inlineCredentials?.private_key) {
    clientOptions.credentials = inlineCredentials;
  } else if (config.credentialsPath) {
    clientOptions.keyFilename = config.credentialsPath;
  }
  return new DocumentProcessorServiceClient(clientOptions);
};

const extractText = (textAnchor, fullText) => {
  if (!textAnchor?.textSegments?.length) return '';
  return textAnchor.textSegments
    .map((segment) => fullText.slice(Number(segment.startIndex || 0), Number(segment.endIndex || 0)))
    .join('');
};

const getFormFields = (document) => {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  return pages.flatMap((page) => (page.formFields || []).map((field) => ({
    fieldName: sanitizeText(extractText(field.fieldName?.textAnchor, document.text || '')),
    fieldValue: sanitizeText(extractText(field.fieldValue?.textAnchor, document.text || '')),
    valueType: field.fieldValue?.valueType || '',
    confidence: field.fieldValue?.confidence || field.fieldName?.confidence || null,
  })));
};

const processScanDocument = async ({ buffer, mimeType }) => {
  if (!isConfigured()) {
    const error = new Error('Google Document AI is not configured.');
    error.code = 'DOCUMENT_AI_NOT_CONFIGURED';
    throw error;
  }

  const config = getConfig();
  const client = createClient();
  const name = client.processorPath(config.projectId, config.location, config.processorId);

  const [result] = await client.processDocument({
    name,
    rawDocument: {
      content: buffer.toString('base64'),
      mimeType,
    },
  });

  return {
    text: sanitizeText(result.document?.text || ''),
    formFields: getFormFields(result.document),
  };
};

const verifyDocumentAiConfiguration = async () => {
  const config = getConfig();
  const inlineCredentials = parseInlineCredentials(config);
  if (!isConfigured()) {
    return {
      ok: false,
      reason: 'Document AI config incomplete',
      config: {
        projectId: config.projectId,
        location: config.location,
        processorId: config.processorId,
        hasCredentialsPath: Boolean(config.credentialsPath),
        hasInlineCredentials: Boolean(inlineCredentials?.client_email && inlineCredentials?.private_key),
      },
    };
  }

  try {
    const client = createClient();
    const name = client.processorPath(config.projectId, config.location, config.processorId);
    const [processor] = await client.getProcessor({ name });
    return {
      ok: true,
      processorName: processor.name,
      displayName: processor.displayName || '',
      type: processor.type || '',
      config: {
        projectId: config.projectId,
        location: config.location,
        processorId: config.processorId,
        hasCredentialsPath: Boolean(config.credentialsPath),
        hasInlineCredentials: Boolean(inlineCredentials?.client_email && inlineCredentials?.private_key),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || String(error),
      code: error?.code || null,
      config: {
        projectId: config.projectId,
        location: config.location,
        processorId: config.processorId,
        hasCredentialsPath: Boolean(config.credentialsPath),
        hasInlineCredentials: Boolean(inlineCredentials?.client_email && inlineCredentials?.private_key),
      },
    };
  }
};

module.exports = {
  isConfigured,
  processScanDocument,
  verifyDocumentAiConfiguration,
};
