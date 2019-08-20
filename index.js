const promiseRetry = require('promise-retry');
const log4js = require('log4js');
log4js.configure({
    appenders: {
        console: {type: 'console'}
    },
    categories: {
        default: {appenders: ['console'], level: 'debug'}
    }
});
const logger = log4js.getLogger();
const AWS = require('aws-sdk');
AWS.config.update({region: 'ap-northeast-2'});
AWS.config.apiVersions = {
    elasticbeanstalk: '2010-12-01',
    s3: '2006-03-01'
};

const elasticbeanstalk = new AWS.ElasticBeanstalk();
const s3 = new AWS.S3();
const fs = require('fs');

/**
 * 기존환경 조회
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const GetOldEnvironment = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'GetOldEnvironment';
        const params = {
            EnvironmentNames: [
                param.oldEnvironmentName
            ]
        };
        logger.info('GetOldEnvironment params', params);
        elasticbeanstalk.describeEnvironments(params, (err, data) => {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('GetOldEnvironment data', data);
                if (data.Environments.length === 1 &&
                    data.Environments[0].Health === 'Green' &&
                    data.Environments[0].HealthStatus === 'Ok' &&
                    data.Environments[0].Status === 'Ready') {
                    param.oldEnvironmentId = data.Environments[0].EnvironmentId;
                    logger.info('GetOldEnvironment param', param);
                    return resolve(param);
                } else {
                    //param.err = new Error('Environment is not unhealthy');
                    return reject(param);
                }
            }
        });
    });
};

/**
 * 설정템플릿 생성
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const CreateConfigurationTemplate = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'CreateConfigurationTemplate';
        const params = {
            ApplicationName: param.applicationName,
            EnvironmentId: param.oldEnvironmentId,
            TemplateName: param.oldEnvironmentName
        };
        logger.info('CreateConfigurationTemplate params', params);
        elasticbeanstalk.createConfigurationTemplate(params, (err, data) => {
            if (err) {
                //fixme 이부분은 문제가 있을듯 하다. 설정템플릿을 삭제하고 다시 만들지 고민해봐야겠다.
                if (err.message.indexOf('already exists') > -1) {
                    param.templateName = params.TemplateName;
                    logger.info('CreateConfigurationTemplate param', param);
                    return resolve(param);
                }
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('CreateConfigurationTemplate data', data);
                param.templateName = data.TemplateName;
                logger.info('CreateConfigurationTemplate param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 새환경 생성
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const CreateNewEnvironment = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'CreateNewEnvironment';
        let newEnvironmentName;
        if (param.oldEnvironmentName.indexOf('-blue') > -1) {
            newEnvironmentName = param.environmentPrefix + '-green';
        } else {
            newEnvironmentName = param.environmentPrefix + '-blue';
        }
        const params = {
            ApplicationName: param.applicationName,
            CNAMEPrefix: newEnvironmentName,
            EnvironmentName: newEnvironmentName,
            TemplateName: param.templateName
        };
        logger.info('CreateNewEnvironment params', params);
        elasticbeanstalk.createEnvironment(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('CreateNewEnvironment data', data);
                param.newEnvironmentId = data.EnvironmentId;
                param.newEnvironmentName = data.EnvironmentName;
                logger.info('CreateNewEnvironment param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 환경의 상태체크
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const WaitHealthyEnvironment = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'WaitHealthyEnvironment';
        const params = {
            AttributeNames: ['All'],
            EnvironmentName: param.newEnvironmentName
        };
        logger.info('WaitHealthyEnvironment params', params);
        elasticbeanstalk.describeEnvironmentHealth(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('WaitHealthyEnvironment data', data);
                if (data.Color === 'Green' &&
                    data.HealthStatus === 'Ok' &&
                    data.Status === 'Ready') {
                    logger.info('WaitHealthyEnvironment param', param);
                    return resolve(param);
                } else {
                    //param.err = new Error('Environment is not unhealthy');
                    return reject(param);
                }
            }
        });
    });
};

/**
 * 애플리케이션파일 S3 에 업로드
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const S3UploadApplication = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'S3UploadApplication';
        const params = {
            Bucket: param.s3Bucket,
            Key: param.s3Key,
            Body: fs.createReadStream(param.deployFile)
        };
        logger.info('S3UploadApplication params', params);
        s3.upload(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('WaitHealthyEnvironment data', data);
                logger.info('WaitHealthyEnvironment param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 애플리케이션버전 생성
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const CreateApplicationVersion = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'CreateApplicationVersion';
        const params = {
            ApplicationName: param.applicationName,
            VersionLabel: param.newEnvironmentName,
            Description: param.newEnvironmentName,
            Process: true,
            SourceBundle: {
                S3Bucket: param.s3Bucket,
                S3Key: param.s3Key
            }
        };
        logger.info('CreateApplicationVersion params', params);
        elasticbeanstalk.createApplicationVersion(params, (err, data) => {
            if (err) {
                //fixme 이부분은 문제가 있을듯 하다. 애플리케이션버전을 삭제하고 다시 만들지 고민해봐야겠다.
                if (err.message.indexOf('already exists') > -1) {
                    param.versionLabel = params.VersionLabel;
                    logger.info('CreateApplicationVersion param', param);
                    return resolve(param);
                }
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('CreateApplicationVersion data', data);
                param.versionLabel = data.ApplicationVersion.VersionLabel;
                logger.info('CreateApplicationVersion param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 새환경에 애플리케이션배포
 *
 * @param param
 * @returns {Promise<any>}
 * @constructor
 */
const UpdateEnvironment = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'CreateApplicationVersion';
        const params = {
            EnvironmentName: param.newEnvironmentName,
            VersionLabel: param.versionLabel
        };
        logger.info('UpdateEnvironment params', params);
        elasticbeanstalk.updateEnvironment(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('UpdateEnvironment data', data);
                logger.info('UpdateEnvironment param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 기존환경과 새환경의 url 상호교체
 *
 * @param param
 * @returns {Promise<unknown>}
 * @constructor
 */
const SwapEnvironmentCName = (param) => {
    return new Promise((resolve, reject) => {
        param.step = 'CreateApplicationVersion';
        const params = {
            SourceEnvironmentName: param.oldEnvironmentName,
            DestinationEnvironmentName: param.newEnvironmentName
        };
        logger.info('SwapEnvironmentCName params', params);
        elasticbeanstalk.swapEnvironmentCNAMEs(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                //param.err = err;
                return reject(param);
            } else {
                logger.info('SwapEnvironmentCName data', data);
                logger.info('SwapEnvironmentCName param', param);
                return resolve(param);
            }
        });
    });
};

/**
 * 환경삭제
 *
 * @param environmentName
 * @returns {Promise<unknown>}
 * @constructor
 */
const TerminateEnvironment = (environmentName) => {
    return new Promise((resolve, reject) => {
        const params = {
            EnvironmentName: environmentName
        };
        logger.info('TerminateEnvironment params', params);
        elasticbeanstalk.terminateEnvironment(params, function (err, data) {
            if (err) {
                logger.error(err, err.stack);
                const param = {
                    environmentName: environmentName,
                    step: 'TerminateEnvironment',
                    err: err
                };
                logger.info('WaitTerminateEnvironment param', param);
                return reject(param);
            } else {
                logger.info('TerminateEnvironment data', data);
                logger.info('TerminateEnvironment environmentName', environmentName);
                return resolve(environmentName);
            }
        });
    });
};

/**
 * 삭제환경 확인
 *
 * @param environmentName
 * @returns {Promise<unknown>}
 * @constructor
 */
const WaitTerminateEnvironment = (environmentName) => {
    return new Promise((resolve, reject) => {
        const params = {
            AttributeNames: ['All'],
            EnvironmentName: environmentName
        };
        logger.info('WaitTerminateEnvironment params', params);
        elasticbeanstalk.describeEnvironmentHealth(params, function (err, data) {
            if (err) {
                //정상적으로 삭제된거임
                if (err.message.indexOf('No Environment found') > -1) {
                    logger.info('WaitTerminateEnvironment environmentName', environmentName);
                    return resolve(environmentName);
                }
                logger.error(err, err.stack);
                const param = {
                    environmentName: environmentName,
                    step: 'WaitTerminateEnvironment',
                    err: err
                };
                logger.info('WaitTerminateEnvironment param', param);
                return reject(param);
            } else {
                logger.info('WaitTerminateEnvironment data', data);
                const param = {
                    environmentName: environmentName,
                    step: 'WaitTerminateEnvironment',
                    err: new Error('Environment is not terminated')
                };
                logger.info('WaitTerminateEnvironment param', param);
                return reject(param);
            }
        });
    });
};


const args = process.argv.slice(2);
logger.info(args);

const phase = args[0];
const moduleName = args[1];
const buildNo = args[2];

if (!phase || !moduleName || !buildNo) {
    throw new Error(`Deploy arguments are invalid ${phase} ${moduleName} ${buildNo}`);
}

const param = {
    deployFile: ``, //배포할 zip 파일
    s3Bucket: '', //S3 버킷명
    s3Key: ``, //S3 키 (파일위치 + 파일명)
    applicationName: '', //Beanstalk 애플리케이션명
    environmentPrefix: ``, //Beanstalk 환경명 Prefix
    oldEnvironmentName: `xxxxxxx-blue` //Beanstalk 기존 환경명
};

GetOldEnvironment(param)
    .catch(() => {
        param.oldEnvironmentName = param.environmentPrefix + '-green';
        return GetOldEnvironment(param);
    })
    .catch(() => {
        param.oldEnvironmentName = param.environmentPrefix;
        return GetOldEnvironment(param);
    })
    .then(CreateConfigurationTemplate)
    .then(CreateNewEnvironment)
    .then((param) => {
        return promiseRetry((retry, number) => {
            logger.info(' Attempt number', number);
            return WaitHealthyEnvironment(param).catch(retry);
        }, {retries: 30, minTimeout: 30000, maxTimeout: 30000});
    })
    .then(S3UploadApplication)
    .then(CreateApplicationVersion)
    .then(UpdateEnvironment)
    .then((param) => {
        return promiseRetry((retry, number) => {
            logger.info(' Attempt number', number);
            return WaitHealthyEnvironment(param).catch(retry);
        }, {retries: 30, minTimeout: 30000, maxTimeout: 30000});
    })
    .then(SwapEnvironmentCName)
    .then((param) => {
        return promiseRetry((retry, number) => {
            logger.info(' Attempt number', number);
            return WaitHealthyEnvironment(param).catch(retry);
        }, {retries: 30, minTimeout: 10000, maxTimeout: 10000});
    })
    .then((param) => {
        return TerminateEnvironment(param.oldEnvironmentName);
    })
    .then((param) => {
        return promiseRetry((retry, number) => {
            logger.info(' Attempt number', number);
            return WaitTerminateEnvironment(param).catch(retry);
        }, {retries: 30, minTimeout: 30000, maxTimeout: 30000});
    })
    .catch((param) => {
        //todo 오류발생시 진행단계를 보고 새환경을 삭제할지 판단하고 삭제해야하지만 일단 문제발생시 수동으로 삭제하자.
        throw new Error(`Fail at ${param.step}`);
    });
