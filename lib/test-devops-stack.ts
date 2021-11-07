import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import { KeyPair } from 'cdk-ec2-key-pair';
import * as iam from '@aws-cdk/aws-iam';
import { Asset } from '@aws-cdk/aws-s3-assets';
import * as path from 'path';
import * as rds from '@aws-cdk/aws-rds';


export class TestDevopsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
      // Create a Key Pair to be used with this EC2 Instance
      const key = new KeyPair(this, 'KeyPair', {
          name: 'cdk-keypair',
          description: 'Key Pair created with CDK Deployment',
      });
      key.grantReadOnPublicKey

      // Create new VPC with 2 Subnets
      const vpc = new ec2.Vpc(this, 'VPC', {
          natGateways: 1,
          subnetConfiguration: [{
              cidrMask: 24,
              name: "application",
              subnetType: ec2.SubnetType.PUBLIC
          },
          {
              cidrMask: 28,
              name: "rds",
              subnetType: ec2.SubnetType.PRIVATE_WITH_NAT
              }
          ]
      });
      // Allow SSH (TCP Port 22) access from anywhere
      const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
          vpc,
          description: 'Allow SSH (TCP port 22) in',
          allowAllOutbound: true
      });
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH Access')

      const role = new iam.Role(this, 'ec2Role', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
      })

      role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))

      // Use Latest Amazon Linux Image - CPU Type ARM64
      const ami = new ec2.AmazonLinuxImage({
          generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
          cpuType: ec2.AmazonLinuxCpuType.ARM_64
      });

      // Create the instance using the Security Group, AMI, and KeyPair defined in the VPC created
      const ec2Instance = new ec2.Instance(this, 'Instance', {
          vpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
          machineImage: ami,
          securityGroup: securityGroup,
          keyName: key.keyPairName,
          role: role
      });
      // Create an asset that will be used as part of User Data to run on first load
      const asset = new Asset(this, 'Asset', { path: path.join(__dirname, '../script/config.sh') });
      const localPath = ec2Instance.userData.addS3DownloadCommand({
          bucket: asset.bucket,
          bucketKey: asset.s3ObjectKey,
      });

      ec2Instance.userData.addExecuteFileCommand({
          filePath: localPath,
          arguments: '--verbose -y'
      });
      asset.grantRead(ec2Instance.role);

      // Create outputs for connecting
      new cdk.CfnOutput(this, 'IP Address', { value: ec2Instance.instancePublicIp });
      new cdk.CfnOutput(this, 'Key Name', { value: key.keyPairName })
      new cdk.CfnOutput(this, 'Download Key Command', { value: 'aws secretsmanager get-secret-value --secret-id ec2-ssh-key/cdk-keypair/private --query SecretString --output text > cdk-key.pem && chmod 400 cdk-key.pem' })
      new cdk.CfnOutput(this, 'ssh command', { value: 'ssh -i cdk-key.pem -o IdentitiesOnly=yes ec2-user@' + ec2Instance.instancePublicIp })

      const rdsinstance = new rds.DatabaseInstance(this, 'rdsInstance', {
          engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_12_3 }),
          // optional, defaults to m5.large
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.SMALL),
          vpc,
          maxAllocatedStorage: 200,
      });

  }
}
